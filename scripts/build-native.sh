#!/bin/bash
# Builds VRKOS's small macOS helper (src/os/native/vrkos.m → vrkos.node).
# Needs Apple's command line tools (xcode-select --install) and Node's headers,
# which come with Node.js. It uses Node-API, so it works in every Electron.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=src/os/native/vrkos.m
OUT=src/os/native/vrkos.node
NODE_INCLUDE="$(dirname "$(dirname "$(node -p 'require("fs").realpathSync(process.execPath)')")")/include/node"

if [ ! -f "$NODE_INCLUDE/node_api.h" ]; then
  echo "build-native: Node's headers aren't at $NODE_INCLUDE" >&2
  exit 1
fi
if [ -f "$OUT" ] && [ "$OUT" -nt "$SRC" ] && [ "$OUT" -nt "$0" ]; then
  exit 0 # up to date
fi

clang -fobjc-arc -bundle -undefined dynamic_lookup -arch arm64 -mmacosx-version-min=12.0 -O2 -Wall \
  -DNODE_GYP_MODULE_NAME=vrkos -I"$NODE_INCLUDE" \
  -framework AppKit -framework CoreGraphics \
  -o "$OUT" "$SRC"
echo "build-native: built $OUT"
