#!/usr/bin/env bash

set -exuo pipefail

curl -L https://github.com/getzola/zola/releases/download/v0.19.2/zola-v0.19.2-x86_64-unknown-linux-gnu.tar.gz | tar xz
./zola build
