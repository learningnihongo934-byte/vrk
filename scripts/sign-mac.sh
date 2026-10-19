#!/usr/bin/env bash
# Signs the built VRK.app: with your personal certificate if you ran
# `npm run setup-signing` (permissions survive updates), otherwise ad-hoc.
set -euo pipefail
APP="${1:?usage: sign-mac.sh path/to/VRK.app}"
DIR="$HOME/.vrk-signing"
KC="$DIR/vrk-signing.keychain-db"

# A free "Apple Development" certificate (Xcode makes one for any Apple ID) works too.
DEV="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development:/ { print $2; exit }')"

if [[ -n "$DEV" ]]; then
  codesign --force --deep --sign "$DEV" "$APP"
  echo "Signed with $DEV."
elif [[ -f "$KC" && -f "$DIR/keychain-password" ]]; then
  security unlock-keychain -p "$(cat "$DIR/keychain-password")" "$KC"
  # The certificate's fingerprint picks it exactly (no name clashes).
  HASH="$(/usr/bin/openssl x509 -in "$DIR/certificate.pem" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)"
  codesign --force --deep --keychain "$KC" --sign "$HASH" "$APP"
  echo "Signed with VRK Local Signing."
else
  codesign --force --deep --sign - "$APP"
  echo "Signed ad-hoc (run npm run setup-signing so permissions survive updates)."
fi
