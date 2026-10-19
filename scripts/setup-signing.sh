#!/usr/bin/env bash
# One-time, free alternative to an Apple Developer account: makes a personal
# code-signing certificate that only this Mac trusts, kept in its own keychain
# (~/.vrk-signing). Every VRK build is then signed with it, so macOS sees each
# update as the same app and keeps your permissions (Full Disk Access, Screen
# Recording…) instead of asking again.
#
#   npm run setup-signing
#
# macOS asks for your password once, to trust the certificate for signing code.
# It can't be used for anything else (websites, email) and never leaves this Mac.
# To undo: delete ~/.vrk-signing and remove "VRK Local Signing" in Keychain Access.
set -euo pipefail

DIR="$HOME/.vrk-signing"
KC="$DIR/vrk-signing.keychain-db"
NAME="VRK Local Signing"

if [[ -f "$KC" ]]; then
  echo "VRK signing is already set up ($KC)."
  exit 0
fi

mkdir -p "$DIR"
chmod 700 "$DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A random password for the keychain, readable only by you; builds use it to unlock.
PASS="$(/usr/bin/openssl rand -hex 24)"
printf '%s' "$PASS" > "$DIR/keychain-password"
chmod 600 "$DIR/keychain-password"

cat > "$WORK/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CNF

echo "→ Making a 10-year code-signing certificate…"
/usr/bin/openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes -config "$WORK/cert.cnf" -keyout "$WORK/key.pem" -out "$WORK/cert.pem" 2>/dev/null
/usr/bin/openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" -name "$NAME" -passout "pass:$PASS" -out "$WORK/cert.p12" 2>/dev/null

echo "→ Putting it in its own keychain…"
security create-keychain -p "$PASS" "$KC"
security set-keychain-settings "$KC" # no auto-lock timeout while building
security unlock-keychain -p "$PASS" "$KC"
security import "$WORK/cert.p12" -k "$KC" -P "$PASS" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASS" "$KC" >/dev/null
cp "$WORK/cert.pem" "$DIR/certificate.pem"

echo "→ Trusting it for code signing (macOS asks for your password)…"
security add-trusted-cert -r trustRoot -p codeSign -k "$KC" "$WORK/cert.pem"

echo
echo "Done. Now rebuild VRK (npm run dist && npm run install-app), then in"
echo "System Settings → Privacy & Security → Full Disk Access remove VRK (–) and add it again (+)."
echo "That's the last time: later updates keep the permission."
