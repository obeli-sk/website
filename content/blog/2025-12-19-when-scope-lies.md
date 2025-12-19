+++
title = "When Scope Lies: The Wildcard Pattern Drop Footgun in Rust"
date = 2025-12-19
+++

One of the big strengths of Rust is its use of automatic memory management.
When a value gets out of scope, the compiler automatically calls
its destructor and frees the memory. During my work on graceful
shutdown I have stumbled on a less known interaction between
scopes and the `_` wildcard pattern that can lead to surprising order of destructors.

<!-- more -->

The wildcard pattern `watcher: _` has a very different semantics
from an actual binding `watcher: _foo`.

```rs
struct Watcher(&'static str);

impl Drop for Watcher {
    fn drop(&mut self) {
        println!("Dropping {}", self.0);
    }
}

fn main() {
    let _w1 = Watcher("_w1");
    let _ = Watcher("_"); // Gets dropped here.
    println!("Done");
}
```
[Playground link](https://play.rust-lang.org/?version=stable&mode=debug&edition=2024&gist=979027897fcb2b73931cf2bcc5f223bb)

The output:
```
Dropping _
Done
Dropping _w1
```

What caught me by surprise is a variant that looks similar but behaves differently.

Imagine you are developing a "clean shutdown" mechanism for a server.
The actual code used a multi-consumer channel to notify Tokio
tasks about shutdown, but here the code is simplified.

```rs
struct Watcher(&'static str);

impl Drop for Watcher {
    fn drop(&mut self) {
        println!("Dropping {}", self.0);
    }
}

struct Server {
    watcher: Watcher,
    other_field: (),
}

impl Server {
    fn close(self) {
        println!("Entering close");
        // Inner scope
        let other_field = {
            // Drop the watcher here
            let Server { watcher: _, other_field } = self;
            println!("Inner scope ends");
            other_field
        };
        // cleanup(other_field);
        println!("Close ends");
    }
}

fn main() {
    let server = Server {
        watcher: Watcher("shutdown_sender"),
        other_field: (),
    };
    server.close();
    println!("Done");
}
```
[Playground link](https://play.rust-lang.org/?version=stable&mode=debug&edition=2024&gist=29e3024280f01793932fe66f07b34001)

It was very unexpected to see this output:

```
Entering close
Inner scope ends
Close ends
Dropping shutdown_sender
Done
```

Turns out the wildcard pattern only tells the compiler to ignore the field in this case.
It does not bind and therefore does not move the value. The field is still owned by self and can be accessed later.

There are several ways to control when it is dropped:

* Bind the field to force an early move: `let Server { watcher: _watcher, other_field } = self;`
* Explicitly drop the field:
```rs
let Server { watcher, other_field } = self;
drop(watcher);
```
* Use `drop(self)` just after the inner scope ends, before dealing with explicitly moved `other_field`:
```rs
fn close(self) {
    let other_field = {
        let Server { watcher: _, other_field } = self;
        other_field
    };
    drop(self);
    // cleanup(other_field);
    println!("Close ends");
}
```

Needless to say, none of these options feels particularly elegant,
but they illustrate how subtle Rust’s drop semantics can be when combined with wildcard patterns.