#!/bin/bash
#
# signing-setup.sh — once per Mac: a local code-signing certificate, so macOS keeps Agent Office's
# permissions (Desktop folder, Accessibility, Automation, Local Network) across updates.
#
# macOS remembers a permission for an app by its signature. scripts/build-app.sh signs ad-hoc
# without this, and an ad-hoc signature is a hash of that exact build, so every update looks like
# a new app and every permission is asked for again. Signed with one certificate, every build is the
# same app to macOS and a permission given once stays.
#
# What it does: makes a self-signed certificate "Agent Office Local Signing", good for code signing
# only, valid 10 years; puts it and its private key in your login keychain; and trusts it for code
# signing (macOS asks for your password to allow that). Nothing leaves this Mac. Then rebuild:
# scripts/build-app.sh picks the certificate up by itself, and so does the in-app updater.
#
#   scripts/signing-setup.sh            # set it up (does nothing when it is already there)
#   scripts/signing-setup.sh --remove   # take the certificate and its key out of the keychain
set -euo pipefail
NAME="Agent Office Local Signing"
KC="$HOME/Library/Keychains/login.keychain-db"

if [[ "${1:-}" == "--remove" ]]; then
  security delete-identity -c "$NAME" "$KC" 2>/dev/null && echo "Removed \"$NAME\". Rebuilds are signed ad-hoc again." \
    || echo "No \"$NAME\" in the login keychain."
  exit 0
fi

if security find-identity -v -p codesigning "$KC" | grep -q "\"$NAME\""; then
  echo "\"$NAME\" is already set up. Rebuild with scripts/build-app.sh."
  exit 0
fi
if security find-identity -p codesigning "$KC" | grep -q "\"$NAME\""; then
  echo "\"$NAME\" is in the keychain but not trusted for code signing. Remove it and run this again:"
  echo "  scripts/signing-setup.sh --remove && scripts/signing-setup.sh"
  exit 1
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$TMP/cert.cnf" \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
# a one-off password for the transfer file only; the key is protected by the keychain afterwards
PASS="$(openssl rand -hex 16)"
openssl pkcs12 -export -legacy -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -out "$TMP/id.p12" -passout "pass:$PASS" 2>/dev/null \
  || openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -out "$TMP/id.p12" -passout "pass:$PASS"
# -T: codesign may use the key without asking each time
security import "$TMP/id.p12" -k "$KC" -P "$PASS" -T /usr/bin/codesign >/dev/null
echo "Trusting \"$NAME\" for code signing: macOS asks for your password."
security add-trusted-cert -p codeSign -k "$KC" "$TMP/cert.pem"

if security find-identity -v -p codesigning "$KC" | grep -q "\"$NAME\""; then
  echo "Done. Rebuild: scripts/build-app.sh"
  echo "macOS asks for each permission once more for the newly signed app, then keeps it across updates."
  echo "If a dialog asks whether codesign may use the key, choose Always Allow."
else
  echo "The certificate is in the keychain but macOS does not list it for code signing." >&2
  echo "Check Keychain Access → login → \"$NAME\" → Trust → Code Signing: Always Trust." >&2
  exit 1
fi
