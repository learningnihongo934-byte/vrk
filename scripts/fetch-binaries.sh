#!/usr/bin/env bash
# Downloads the Tor and WireGuard (wireproxy) binaries VRK bundles, verifying
# each archive against the SHA-256 published by the upstream project.
#
#   bash scripts/fetch-binaries.sh          # this Mac      → vendor/
#   bash scripts/fetch-binaries.sh win      # Windows x64   → vendor-win/
#   bash scripts/fetch-binaries.sh linux    # Linux x64     → vendor-linux/
set -euo pipefail

TOR_VERSION="${TOR_VERSION:-15.0.25}"
WIREPROXY_VERSION="${WIREPROXY_VERSION:-v1.1.3}"
TARGET="${1:-mac}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

case "$TARGET" in
  mac)
    VENDOR="$ROOT/vendor"
    case "$(uname -m)" in
      arm64) TOR_NAME=macos-aarch64; WP_NAME=darwin_arm64 ;;
      x86_64) TOR_NAME=macos-x86_64; WP_NAME=darwin_amd64 ;;
      *) echo "Unsupported architecture $(uname -m)" >&2; exit 1 ;;
    esac ;;
  win) VENDOR="$ROOT/vendor-win"; TOR_NAME=windows-x86_64; WP_NAME=windows_amd64 ;;
  linux) VENDOR="$ROOT/vendor-linux"; TOR_NAME=linux-x86_64; WP_NAME=linux_amd64 ;;
  *) echo "Usage: fetch-binaries.sh [mac|win|linux]" >&2; exit 1 ;;
esac

verify() { # file expected-sha256
  local actual
  actual="$(shasum -a 256 "$1" | cut -d' ' -f1)"
  if [[ "$actual" != "$2" ]]; then
    echo "Checksum mismatch for $(basename "$1"): got $actual, expected $2" >&2
    exit 1
  fi
  echo "  ✓ sha256 verified: $(basename "$1")"
}

echo "→ Tor expert bundle $TOR_VERSION ($TOR_NAME)"
TOR_BASE="https://dist.torproject.org/torbrowser/$TOR_VERSION"
TOR_FILE="tor-expert-bundle-$TOR_NAME-$TOR_VERSION.tar.gz"
curl -fsSL "$TOR_BASE/$TOR_FILE" -o "$WORK/$TOR_FILE"
TOR_SUM="$(curl -fsSL "$TOR_BASE/sha256sums-signed-build.txt" | awk -v f="$TOR_FILE" '$2 == f { print $1 }')"
[[ -n "$TOR_SUM" ]] || { echo "No published checksum for $TOR_FILE" >&2; exit 1; }
verify "$WORK/$TOR_FILE" "$TOR_SUM"
rm -rf "$VENDOR/tor"
mkdir -p "$VENDOR/tor"
tar -xzf "$WORK/$TOR_FILE" -C "$VENDOR/tor"

echo "→ wireproxy $WIREPROXY_VERSION ($WP_NAME)"
WP_BASE="https://github.com/windtf/wireproxy/releases/download/$WIREPROXY_VERSION"
WP_FILE="wireproxy_$WP_NAME.tar.gz"
curl -fsSL "$WP_BASE/$WP_FILE" -o "$WORK/$WP_FILE"
WP_SUM="$(curl -fsSL "$WP_BASE/checksums.txt" | awk -v f="$WP_FILE" '$2 == f { print $1 }')"
[[ -n "$WP_SUM" ]] || { echo "No published checksum for $WP_FILE" >&2; exit 1; }
verify "$WORK/$WP_FILE" "$WP_SUM"
rm -rf "$VENDOR/wireproxy"
mkdir -p "$VENDOR/wireproxy"
tar -xzf "$WORK/$WP_FILE" -C "$VENDOR/wireproxy"

if [[ "$TARGET" == mac ]]; then
  chmod +x "$VENDOR/tor/tor/tor" "$VENDOR/wireproxy/wireproxy"
  # The Tor expert bundle ships unsigned; Apple Silicon refuses to run unsigned
  # code, so give every Mach-O in it an ad-hoc signature.
  codesign --force -s - "$VENDOR"/tor/tor/*.dylib "$VENDOR/tor/tor/tor"
  find "$VENDOR/tor/tor/pluggable_transports" -type f -perm +111 -exec codesign --force -s - {} \;
elif [[ "$TARGET" == linux ]]; then
  chmod +x "$VENDOR/tor/tor/tor" "$VENDOR/wireproxy/wireproxy"
fi

echo "Done. Binaries are in $VENDOR"
