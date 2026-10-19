#!/usr/bin/env bash
# VRK installer for macOS and Linux:  curl -fsSL https://vrkweb.web.app/install | bash
# (Windows: irm https://vrkweb.web.app/install-windows | iex)
#
# macOS: downloads VRK, installs it in /Applications, clears the "downloaded
# from the internet" flag and signs it for this Mac, so it opens without a paid
# Apple certificate. Linux: installs the .deb (Debian, Ubuntu) or the AppImage.
set -euo pipefail

RELEASE="https://vrkweb.web.app/downloads"
say() { printf "\033[1;35m◆ VRK\033[0m %s\n" "$*"; }
fail() { say "$*"; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

install_mac() {
  [ "$(uname -m)" = arm64 ] || fail "VRK needs a Mac with an Apple chip (M1 or newer)."
  if pgrep -f "/Applications/VRK.app/Contents/MacOS/VRK" >/dev/null 2>&1; then
    fail "Quit VRK first (VRK menu → Quit), then run this again."
  fi
  say "Downloading VRK for macOS…"
  curl -fL --progress-bar "$RELEASE/VRK-mac-arm64.zip" -o "$WORK/VRK.zip"
  ditto -x -k "$WORK/VRK.zip" "$WORK"
  [ -d "$WORK/VRK.app" ] || fail "The download didn't contain VRK.app."
  # Not downloaded by a browser any more, and signed for this Mac: Gatekeeper lets it open.
  xattr -dr com.apple.quarantine "$WORK/VRK.app" 2>/dev/null || true
  codesign --force --deep --sign - "$WORK/VRK.app" >/dev/null 2>&1 || true
  say "Installing in /Applications…"
  if [ -d /Applications/VRK.app ]; then
    mv /Applications/VRK.app "$WORK/VRK-old.app" # replaced only once the new one is ready
  fi
  ditto "$WORK/VRK.app" /Applications/VRK.app
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/VRK.app >/dev/null 2>&1 || true
  say "Done. Opening VRK…"
  open /Applications/VRK.app
}

install_linux() {
  [ "$(uname -m)" = x86_64 ] || fail "VRK for Linux needs a 64-bit Intel or AMD computer (x86_64)."
  if command -v apt-get >/dev/null 2>&1; then
    say "Downloading VRK (.deb)…"
    curl -fL --progress-bar "$RELEASE/VRK-linux-amd64.deb" -o "$WORK/vrk.deb"
    say "Installing (asks for your password)…"
    sudo apt-get install -y "$WORK/vrk.deb"
    say "Done. Open VRK from your apps menu, or type: vrk"
    return
  fi
  say "Downloading VRK (AppImage)…"
  local dir="$HOME/.local/share/vrk"
  mkdir -p "$dir" "$HOME/.local/bin" "$HOME/.local/share/applications"
  curl -fL --progress-bar "$RELEASE/VRK-linux-x86_64.AppImage" -o "$dir/VRK.AppImage"
  chmod +x "$dir/VRK.AppImage"
  curl -fsSL "https://vrkweb.web.app/icon.png" -o "$dir/icon.png" || true
  # AppImages need FUSE 2; without it, VRK unpacks itself each launch instead.
  local run="$dir/VRK.AppImage"
  if ! ldconfig -p 2>/dev/null | grep -q libfuse.so.2; then run="env APPIMAGE_EXTRACT_AND_RUN=1 $dir/VRK.AppImage"; fi
  printf '#!/bin/sh\nexec %s "$@"\n' "$run" > "$HOME/.local/bin/vrk"
  chmod +x "$HOME/.local/bin/vrk"
  cat > "$HOME/.local/share/applications/vrk.desktop" <<DESKTOP
[Desktop Entry]
Name=VRK
Comment=Private, ad-blocking web browser
Exec=$HOME/.local/bin/vrk %U
Icon=$dir/icon.png
Type=Application
Categories=Network;WebBrowser;
MimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;
StartupWMClass=VRK
DESKTOP
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
  say "Done. Open VRK from your apps menu, or type: vrk"
}

case "$(uname)" in
  Darwin) install_mac ;;
  Linux) install_linux ;;
  *) fail "On Windows, run this in PowerShell instead:  irm https://vrkweb.web.app/install-windows | iex" ;;
esac
