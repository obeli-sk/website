+++
title = "Challenging the Fastest OSS Workflow Engine"
date = 2025-10-29
+++

November marks 2 years since I started working on Obelisk, an OSS workflow engine written in Rust.

As a reflection on its capabilities I have decided to make a friendly comparison with [WindMill](https://www.windmill.dev),
which produced an interesting [benchmark](https://www.windmill.dev/docs/misc/benchmarks/competitors/windmill) accompanied by
a blog post titled
[Fastest self-hostable open-source workflow engine](https://www.windmill.dev/blog/launch-week-1/fastest-workflow-engine).

<!-- more -->

<script src="{{ get_url(path="plotly-2.35.3.min.js") }}"></script>

<script>

function colorFor(label) {
    return label.startsWith('Obelisk') ? '#1f77b4' : '#9fb8bf';
}

function makePlot(dataArray, div, title) {
    const sortedByTime = true;
    let arr = dataArray.slice();
    if (sortedByTime) {
        arr.sort((a, b) => a[1] - b[1]);
    }

    const labels = arr.map(r => r[0]);
    const values = arr.map(r => r[1]);
    const colors = labels.map(colorFor);

    const trace = {
        x: values,
        y: labels,
        type: 'bar',
        orientation: 'h',
        marker: { color: colors, line: { width: 0 } },
        hovertemplate: '%{y}<br>Time: %{x:.3f} s<extra></extra>'
    };
    const css = getComputedStyle(document.documentElement);
    const textColor = css.getPropertyValue('--text').trim();
    const layout = {
        margin: { l: 240, r: 24, t: 48, b: 48 },
        xaxis: { title: 'Time (s)', showgrid: true, zeroline: false, color: textColor },
        yaxis: { automargin: true, categoryorder: 'array', categoryarray: labels, color: textColor },
        height: Math.max(420, labels.length * 48),
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        title: { text: title + ' — Time (s)', x: 0.01, xanchor: 'left',  font: { color: textColor } }
    };

    const config = { responsive: true, displayModeBar: false };

    Plotly.newPlot(div, [trace], layout, config);
}
</script>

The benchmark compares a naive implementation of Fibonacci written in various programming languages:

```rs
fn fibo(n: u8) -> u64 {
    if n <= 1 {
        n.into()
    } else {
        fibo(n - 1) + fibo(n - 2)
    }
}
```

The following (and more) workflow engines were compared:
* WindMill
* Temporal
* Perfect
* Airflow

## Note about fairness
As a usual caeviat, you should make your own benchmarks based on your specific needs.
I am attempting to use the same methodology, but I did not retest any of the competitors as WindMill did.
However I am using the same AWS instance type, `t2-medium` so hopefully this gives at least some common ground.

The main focus here however is how Obelisk improved from its own baseline, and how compiled languages (Rust, Go)
compare to JavaScript and Python, when running inside WASM, as well as how WASM compares to native code.

Scroll down for actual benchmark numbers.

## Why is Obelisk fast
- everything runs inside a single process
- WASM based: supports lightweight VM execution
- sqlite - eliminates network roundtrips

## Setting the baseline

Calculating Fibonacci(10) over and over seems to be the most boring test, but it shows some aspects of work that workflow
engines must do:
* Monitoring pending executions
* Locking to avoid multiple executors working on the same item
* Managing the execution, spawning child executions in case of workflows, timeouting when needed in case of activities
* Writing the finished execution result and notifying other executions waiting for the results

Running a workflow like [this one](https://github.com/obeli-sk/benchmark-fibo/blob/main/workflow/rs/src/lib.rs):
```rs
fn fiboa(n: u8, iterations: u32) -> Result<u64, ()> {
    let mut last = 0;
    for _ in 0..iterations {
        last = fibo_activity(n).unwrap();
    }
    Ok(last)
}
```
gives little hope to any optimizations. Everytime the workflow spawns a child execution using `fibo_activity`, the
engine must submit a new execution to the database and wait until the result arrives. Obelisk has two tricks
up its sleeve: a simple pubsub mechanism using [Tokio](https://tokio.rs/) channels avoids polling the database, and two waiting strategies.
The `interrupt`ing strategy removes the blocked workflow from memory and replays its execution log later, and
a `await`ing strategy, as the name suggests, keeps the execution hot for some time, hoping the result arrives sooner
than the deadnline. To avoid replays, the benchmarks use the `await` strategy with a long timeout.

## Exploiting determinism

In the previous code, every activity call must be committed to the database, because the in order to continue the workflow we must
obtain the `fibo_activity` result.
What if we rewrote the code to spawn all the child executions at once, returning just a promise instead?
```rs
fn fiboa_concurrent(n: u8, iterations: u32) -> Result<u64, ()> {
    let join_set = new_join_set_generated(ClosingStrategy::Complete);
    for _ in 0..iterations {
        fibo_submit(&join_set, n);
    }
    let mut last = 0;
    for _ in 0..iterations {
        last = fibo_await_next(&join_set).unwrap().1.unwrap();
    }
    Ok(last)
}
```

Not only can we calculate Fibonacci in parallel, but we can delay the expensive `fsync`s as well:

Instead of comitting on every `fibo_submit`, we can transparently collect all events that can be delayed,
and submit them together in one big transaction. If the workflow engine crashes, this state is not lost,
since the exact same events will be recreated after replay in the next execution run because of guaranteed determinism.

The caching of execution events is available for the `await` strategy mentioned above.

## Exploiting idempotency - new in v0.26.1

Contrary to WindMill's use of Postgres, there is no row based locking in sqlite. This can become a bottleneck,
as every execution first needs to be locked, then processed and then its result needs to be written. However it has
also an advantage, as all Obelisk transactions are short lived with very limited interactivity during transaction.

We can use a similar mechanism as replaying workflows: What was previously a sqlite transaction becomes an
[`FnMut`](https://doc.rust-lang.org/std/ops/trait.FnMut.html)
closure, producing a logical transaction (LTX). We can then pack many LTX-es into a single "physical" transaction.

Sqlite is already effectively single-threaded when it comes to writes, and the writer thread is either waiting
on incoming transaction requests, processing the transaction, or blocked on comitting to disk.
Thus, we can collect LTX closures while an `fsync` is in
progress, then open a single "physical" transaction and start processing LTX closures, until the LTX channel is drained.

What about a single LTX failing? It brings down the original bulk transaction, but we can replay each LTX in its
own transaction.

This mechanism adds a small delay between activity finish and transaction commit. However, there is already a
data loss window when the server crashes right after an activity succeeds. This is one of the reasons all
activities in Obelisk must be idempotent - they can be restarted even if the previous execution succeeded.

During local testing, the LTX bulking improved the concurrent workflow from around 140 executions per second to around 220.
Execution speed of the original `fiboa` workflow remains the same, however the throughput of running many independent executions is improved.

## Cheat mode
Obelisk sets up sqlite with WAL (write-ahead log) and `synchronous` mode set to `full`, meaning every transaction commit triggers
an `fsync`.
In certain situations, when losing last few transactions after a crash is not a deal breaker, one can switch to `normal` mode,
which writes transactions in yet another bulk with a single `fsync` when the WAL is full.

Setting it is also encouraged in [Litestream's Tips & Caveats](https://litestream.io/tips/#synchronous-pragma) section,
noting that there already is a data loss window when using an async replication.

Relaxed `fsync` can be configured using following TOML snippet:
```
sqlite.pragma = { "synchronous" = "normal" }
```

I have not included benchmarks with this setting (all benchmarks use `full` synchronization), however
with this setting I was able to get from 220 to more than a 1000 light-weight executions per second locally.

# Benchmark results
The instance type [t2-medium](https://aws.amazon.com/ec2/instance-types/t2/) has good IO and per-core CPU performance,
but it has just 2 vcpus and the CPU performance is bursty, which may skew results.

As for the Obelisk setup, all workflows, activities, native fibo implementation and config files are available
in [benchmark-fibo](https://github.com/obeli-sk/benchmark-fibo/) repository.

## WASM vs native code
All Obelisk benchmarks except `Obelisk - Rust + native` have the same architecture: One workflow and one activity,
both implemented in the same language, compiled to [WASM Components](https://component-model.bytecodealliance.org).

The native benchmark runs WASM workflow, which in turn executes WASM activity, which uses the
{{ doc_link(title="Process API", path="concepts/activities/process.md") }} to execute the native process,
which does the actual Fibonacci calculation, so `Fibo(10) * 1000 iterations` spawns 1000 `N=10 fibo` processes.

## Small CPU Activity
Workflow calling a short activity sequentially 40 times.

<div class="plot" id="plot-fibo-10-40"></div>

<script>
    {
        const raw = [
            ["WindMill - Python", 4.383],
            ["WindMill Dedicated - Python", 2.092],
            ["WindMill - JavaScript", 2.973],
            ["WindMill Dedicated - JavaScript", 2.125],
            ["WindMill - Go", 2.973],
            ["Obelisk - Rust", 0.226],
            ["Obelisk - Rust + native", 0.292],
            ["Obelisk - Go", 0.310],
            ["Obelisk - Python", 0.383],
            ["Obelisk - JavaScript", 0.263]
        ];
        makePlot(raw, "plot-fibo-10-40", "Fibo(10) * 40 iterations");
    }
</script>

## Medium CPU activity

<div class="plot" id="plot-fibo-33-10"></div>

<script>
    {
        const raw = [
            ["WindMill - Python", 8.347],
            ["WindMill Dedicated - Python", 7.701],
            ["WindMill - JavaScript", 0.935],
            ["WindMill Dedicated - JavaScript", 1.077],
            ["WindMill - Go", 0.780],
            ["Obelisk - Rust", 0.379],
            ["Obelisk - Rust + native", 0.220],
            ["Obelisk - Go", 0.444],
            ["Obelisk - Python", 18.761],
            ["Obelisk - JavaScript", 38.214]
        ];
        makePlot(raw, "plot-fibo-33-10", "Fibo(33) * 10 iterations");
    }
</script>

Both Go and Rust purely in WASM are still performing well, however Python and JavaScript in WASM lag behind.

## Large CPU activity
In this benchmark a workflow executes 100 times an activity, each computing Fibo(38).
As JavaScript and Python in WASM were already struggling with Fibo(33), I excluded them from the next test.

[WindMill's benchmark documentation](https://www.windmill.dev/docs/misc/benchmarks/competitors/windmill#fibonacci-100-iterations-n-38)
also has no results for these languages.

This benchmark shows, perhaps unsurprisingly, that a WASM runtime cannot compete with native code.
However, I believe in starting with a WASM and only converting it to native code when needed as most
real-world code is going to be blocked by network calls.

<div class="plot" id="plot-fibo-38-100"></div>

<script>
{
  const raw = [
    ["WindMill - Go", 27.648],
    ["Obelisk - Rust", 35.127],
    ["Obelisk - Rust + native", 15.521],
    ["Obelisk - Go", 41.642]
  ];
  makePlot(raw, "plot-fibo-38-100", "Fibo(38) * 100 iterations");
}
</script>

## Adding parallelism
This benchmark calculates Fibo(38), with 100 iterations, however the activities are now processed in parallel.
Note that the `t2-median` has only 2 vcpus, these benchmarks would look much better if more parallelism was available.
However it shows the difference between running WASM binaries and native code.

<div class="plot" id="plot-fibo-38-100-parallel"></div>

<script>
{
  const raw = [
    ["WindMill - Go with 10 workers", 11.899],
    ["Obelisk - Rust", 17.456],
    ["Obelisk - Rust + native", 7.653],
    ["Obelisk - Go", 20.717]
  ];
  makePlot(raw, "plot-fibo-38-100-parallel", "Fibo(38) * 100 iterations (parallel)");
}
</script>

I am adding another benchmark, with a lot of parallel executions with a very little CPU activity:

<div class="plot" id="plot-fibo-10-1000-parallel"></div>

<script>
{
  const raw = [
    ["Obelisk - Rust", 4.367],
    ["Obelisk - Rust + native", 4.729],
    ["Obelisk - Go", 4.262],
    ["Obelisk - Python", 5.233],
    ["Obelisk - JavaScript", 4.910]
  ];
  makePlot(raw, "plot-fibo-10-1000-parallel", "Fibo(10) * 1000 iterations (parallel)");
}
</script>

This test focuses on database pressure more than CPU and is reaping the benefits described in the *Exploiting determinism*
and *Exploiting idempotency* sections.


## Conclusion
A key finding is that a simple architecture can often beat a more complex system. Obelisk has no Docker Compose file,
as the entire thing - database, orchestrator, webhooks, workflows and activities all run in a single process.

The tests were using an AWS instance with 4GB of RAM to keep in line with the original benchmark,
but Obelisk is capable of running inside much smaller VMs, typically 256 to 512MB.

Although WASM will never beat native code in CPU intensive applications, it is suitable for this use case,
supporting creation of thousands lightweight VMs per second, unloading running workflows from memory when needed
and replaying execution events with guaranteed determinism.

As technologies like [Wasmtime](https://wasmtime.dev/), [Litestream](https://litestream.io), and
[Turso DB](https://github.com/tursodatabase/turso) mature,
this simplified deployment model will become increasingly accessible and common.
