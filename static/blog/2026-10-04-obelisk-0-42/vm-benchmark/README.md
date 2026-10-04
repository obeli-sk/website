# Obelisk 0.42.0 activity VM measurements

Measured on 2026-10-04, on one Intel Core i9-14900HX host running Linux 6.18.43.
All VM cases used the published Obelisk 0.42.0 x86_64 Linux musl binary, not a local build.
Its SHA256 is `3d7943bb46e7f9fa12e22348a54e67d2cb991c0a9b30b18148aedf7b1c7759df`.
The measured demo source is pinned to [920f611](https://github.com/obeli-sk/demo-playwright/tree/920f611cb910dd37f5bee830c0bcd42523e891ae).
[summary.json](summary.json) records exact medians, ranges, sample counts, input hashes, resource sizes,
and the immutable runtime OCI digests. The adjacent CSV files contain every measured activity ID,
its persisted timestamps, and calculated latency.

## Results

Values are median seconds; parentheses give measured sample counts.

| Workload | Firecracker | QEMU KVM | QEMU TCG | Bochs WASM |
| --- | ---: | ---: | ---: | ---: |
| Bash printf | 0.155 s (7) | 0.144 s (7) | 0.431 s (7) | 0.966 s (7) |
| Curl local page | 0.180 s (7) | 0.187 s (7) | 0.694 s (7) | 2.342 s (7) |
| Chromium / trynix.dev | 13.713 s (3) | 13.124 s (3) | not measured | not measured |

## Method

Latency is the difference between each activity's persisted Locked and Finished timestamps.
It includes VM setup, the command, and result persistence. It excludes deployment verification,
runtime downloads, and server startup. The browser case times the browser activity, not its parent
workflow. All measured activities succeeded.

Backends ran sequentially, with an isolated SQLite database and a separate server for each
backend. Bash and curl shared a server; Chromium used a fresh server and database.
Bash and curl have two discarded warmups and seven measured executions each.
Chromium has one discarded warmup and three measured executions per backend. Runtime images
were cached before measurement. QEMU used the published 2026-10-01 EROFS bundles and QEMU 11.1.1;
Firecracker used its published 2026-10-01 bundle and Firecracker 1.16.1. Exact runtime digests are
in summary.json.

Bash prints hello with printf. Curl fetches the local task-list page through Obelisk's guest HTTP
bridge. Both use 512 MiB and one guest vCPU. Chromium uses 8 GiB and four vCPUs: Playwright opens
trynix.dev, boots its in-browser Linux VM with the stable Obelisk store path in summary.json,
runs obelisk -v, and returns the output. This includes the in-browser boot and external HTTP work.
Docker was not measured in this run because its daemon was unavailable; no earlier Docker sample
is mixed into this table. Browser workloads were not measured on Bochs or QEMU TCG.

## Repeat

Check out the pinned demo source and enter its Nix development shell. Put the published
Obelisk 0.42.0 binary in a directory named by RELEASE_BIN_DIR, ahead of the shell's Obelisk on PATH.
The release download is available from [v0.42.0](https://github.com/obeli-sk/obelisk/releases/tag/v0.42.0).

```sh
export RELEASE_BIN_DIR=/path/to/published/obelisk/bin
nix develop
export PATH="$RELEASE_BIN_DIR:$PATH"
obelisk --version  # must print obelisk 0.42.0
export OBELISK_API_TOKEN="$(obelisk generate token)"
export OBELISK_API_URL=http://127.0.0.1:15015
export OBELISK__API__LISTENING_ADDR=127.0.0.1:15015
export OBELISK__EXTERNAL__ENABLED=false
export OBELISK__WEBUI__ENABLED=false
node todoapp/page/server.mjs  # separate terminal; serves 127.0.0.1:8090
```

For each of qemu-kvm, qemu-tcg, firecracker, and bochs-wasm, start a separate bench server
with those environment variables in a second terminal. Substitute the chosen backend below,
and use a fresh SQLite directory for each server:

```sh
export OBELISK_UNSTABLE_ACTIVITY_VM=qemu-kvm
export OBELISK__DATABASE__SQLITE__DIRECTORY=/tmp/bench-042-qemu-kvm
cd bench
obelisk server run --app-config app-vm.toml --deployment deployment-vm.toml
```

From the repository root in the sampling terminal:

```sh
bash scripts/bench.sh echo qemu-kvm 7 2 > echo-qemu-kvm.csv
bash scripts/bench.sh curl qemu-kvm 7 2 > curl-qemu-kvm.csv
```

Stop that server before switching backends. For the two Chromium cases, start the server from
inception/ instead of bench/, use a fresh database, and measure the explicit stable store path:

```sh
bash scripts/bench.sh inception qemu-kvm 3 1 /nix/store/82b2qf8r29jykh3jlkq2dxk5nghgj23v-obelisk-0.42.0 > inception-qemu-kvm.csv
```

Repeat that browser command with firecracker and its separate server/database.
