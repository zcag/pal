#!/usr/bin/env bash
# Stage what the extension host needs at runtime into app/src-tauri/resources,
# the tree `bundle.resources` in tauri.conf.json ships (macOS: pal.app/Contents/
# Resources, Linux: usr/lib/pal):
#
#   resources/host/src/*.ts            the host, run by the bun sidecar as-is
#   resources/extensions/<name>/index.js   each extension bundled to one file
#
# `bun build` inlines an extension's dependencies (calc's mathjs, emoji's
# data.json), so no node_modules ships. Imports of ../../host/src/* stay
# external: the layout above keeps them resolvable, and the bridge in
# host/src must be one module instance shared with the host, not a copy
# per extension.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
out="$root/app/src-tauri/resources"
bun=${BUN:-$(command -v bun || true)}
if [ -z "$bun" ]; then
  triple=$(rustc -vV | sed -n 's/^host: //p')
  bun="$root/app/src-tauri/binaries/pal-bun-$triple"
  [ -x "$bun" ] || "$root/app/scripts/fetch-bun.sh" "$triple"
fi

# Staged in a temp dir and synced by checksum, so a file that did not change
# keeps its mtime: tauri-build watches the tree and would otherwise re-link
# the app on every build.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/host/src" "$tmp/extensions"
cp "$root"/host/src/*.ts "$tmp/host/src/"
for entry in "$root"/extensions/*/index.ts; do
  name=$(basename "$(dirname "$entry")")
  "$bun" build "$entry" --target bun --outdir "$tmp/extensions/$name" --external '../../host/src/*' >/dev/null
done
mkdir -p "$out"
rsync -rc --delete "$tmp/" "$out/"
echo "build-extensions: $(ls "$out/extensions" | tr '\n' ' ')-> $out"
