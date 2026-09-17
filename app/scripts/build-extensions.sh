#!/usr/bin/env bash
# Stage what the extension host needs at runtime into app/src-tauri/resources,
# the tree `bundle.resources` in tauri.conf.json ships (macOS: pal.app/Contents/
# Resources, Linux: usr/lib/pal):
#
#   resources/host/src/*.ts            the host, run by the bun sidecar as-is
#   resources/sdk/{package.json,src/*.ts}  the SDK (`@zcag/pal`): the host
#                                          imports it by relative path and
#                                          links it into every user root
#   resources/extensions/<name>/index.js   each extension bundled (a dynamic
#                                          import is its own chunk beside it)
#   resources/extensions/<name>/pal.json   its manifest: the host reads the
#                                          settings defaults and title from it
#
# `bun build` inlines an extension's dependencies (emoji's data.json) and
# its import of `@zcag/pal` (resolved through the root workspace, so `bun
# install` at the repo root first), so no node_modules ships and nothing in
# the bundle needs a node_modules link. A copy of the SDK per extension is
# fine: it reaches the host through a process-wide slot (sdk/src/runtime.ts),
# not a shared module instance. `--splitting` keeps a dynamic import (calc's
# mathjs, 1.3 MB) in a chunk of its own, loaded on first use rather than
# parsed with the entry.
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
mkdir -p "$tmp/host/src" "$tmp/sdk/src" "$tmp/extensions"
cp "$root"/host/src/*.ts "$tmp/host/src/"
cp "$root"/sdk/package.json "$tmp/sdk/"
cp "$root"/sdk/src/*.ts "$tmp/sdk/src/"
for entry in "$root"/extensions/*/index.ts; do
  name=$(basename "$(dirname "$entry")")
  "$bun" build "$entry" --target bun --splitting --outdir "$tmp/extensions/$name" >/dev/null
  cp "$(dirname "$entry")/pal.json" "$tmp/extensions/$name/"
done
mkdir -p "$out"
rsync -rc --delete "$tmp/" "$out/"
echo "build-extensions: $(ls "$out/extensions" | tr '\n' ' ')-> $out"
