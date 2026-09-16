#!/usr/bin/env bash
# Fetch the Bun release binary that ships inside pal as the extension host,
# one per Rust target triple, into app/src-tauri/binaries/bun-<triple> (the
# name tauri's `bundle.externalBin` expects). Verified against the SHA256 the
# release publishes. No argument: the triple this machine builds for.
#
#   app/scripts/fetch-bun.sh                       # host triple
#   app/scripts/fetch-bun.sh x86_64-unknown-linux-gnu aarch64-apple-darwin
set -euo pipefail

BUN_VERSION=1.4.2
base="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION"
out=$(cd "$(dirname "$0")/../src-tauri" && pwd)/binaries

asset() {
  case "$1" in
    aarch64-apple-darwin) echo bun-darwin-aarch64 ;;
    x86_64-apple-darwin) echo bun-darwin-x64 ;;
    x86_64-unknown-linux-gnu) echo bun-linux-x64 ;;
    aarch64-unknown-linux-gnu) echo bun-linux-aarch64 ;;
    *) echo "fetch-bun: no bun build for $1" >&2; exit 1 ;;
  esac
}

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

triples=("$@")
[ ${#triples[@]} -gt 0 ] || triples=("$(rustc -vV | sed -n 's/^host: //p')")

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
mkdir -p "$out"

for triple in "${triples[@]}"; do
  name=$(asset "$triple")
  dest="$out/bun-$triple"
  if [ -x "$dest" ] && "$dest" --version 2>/dev/null | grep -qx "$BUN_VERSION"; then
    echo "fetch-bun: $dest is already $BUN_VERSION"
    continue
  fi
  want=$(grep " $name.zip\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)
  [ -n "$want" ] || { echo "fetch-bun: $name.zip not in SHASUMS256.txt" >&2; exit 1; }
  curl -fsSL "$base/$name.zip" -o "$tmp/$name.zip"
  got=$(sha256 "$tmp/$name.zip")
  [ "$got" = "$want" ] || { echo "fetch-bun: checksum mismatch for $name.zip: $got != $want" >&2; exit 1; }
  unzip -qo "$tmp/$name.zip" -d "$tmp"
  mv "$tmp/$name/bun" "$dest"
  chmod +x "$dest"
  echo "fetch-bun: $dest ($BUN_VERSION)"
done
