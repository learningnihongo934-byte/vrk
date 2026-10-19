#!/usr/bin/env bash
# Builds VRK.  ./build.sh          → this Mac (dist.noindex/mac-arm64/VRK.app)
#              ./build.sh win      → Windows installer + zip
#              ./build.sh linux    → Linux AppImage + .deb
#              ./build.sh all      → all three, plus the Mac .zip for the website
#              ./build.sh site     → publish vrkweb.web.app (Firebase)
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
[ -d vendor ] || bash scripts/fetch-binaries.sh
case "${1:-mac}" in
  mac) npm run dist ;;
  win) npm run dist:win ;;
  linux) npm run dist:linux ;;
  all) npm run dist:mac-zip && npm run dist:win && npm run dist:linux ;;
  site) (cd website && firebase deploy --only hosting) ;;
  *) echo "Usage: ./build.sh [mac|win|linux|all|site]"; exit 1 ;;
esac
