#!/usr/bin/env bash
# Import pal's macOS signing identity, `pal-dev` (a self-signed certificate
# and its key, exported as a .p12), so the bundle is signed with it. Every
# pal, a release or a `make app`, is signed with this one identity: macOS
# ties Accessibility, Input Monitoring and Full Disk Access to the signature,
# and an ad-hoc one is the build's own hash, so each update lost them.
#
# In CI (RUNNER_TEMP set) into a keychain of its own, unlocked and put on the
# search list, so tauri's `codesign -s pal-dev` finds it; elsewhere into the
# login keychain (the first signature may ask to use the key: Always Allow).
# No trust setting is needed to sign with it.
#
#   app/scripts/signing-key.sh <file.p12> <password>
set -euo pipefail

p12=$1 pw=$2
if [ -n "${RUNNER_TEMP:-}" ]; then
  kc="$RUNNER_TEMP/signing.keychain-db"
  kpw=$(openssl rand -hex 16)
  security create-keychain -p "$kpw" "$kc"
  security set-keychain-settings "$kc" # no lock timeout
  security unlock-keychain -p "$kpw" "$kc"
  security import "$p12" -k "$kc" -P "$pw" -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$kpw" "$kc" >/dev/null
  # shellcheck disable=SC2046 # the list is one path per word
  security list-keychains -d user -s "$kc" $(security list-keychains -d user | tr -d '"')
else
  security import "$p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$pw" -T /usr/bin/codesign >/dev/null
fi
security find-identity -p codesigning | grep -q '"pal-dev"' || { echo "pal-dev is not a signing identity after the import" >&2; exit 1; }
echo "signing identity: pal-dev"
