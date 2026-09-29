#!/usr/bin/env bash
# Stage what the extension host needs at runtime into app/src-tauri/resources,
# the tree `bundle.resources` in tauri.conf.json ships (macOS: pal.app/Contents/
# Resources, Linux: usr/lib/pal):
#
#   resources/host/src/*.ts            the host, run by the bun sidecar as-is
#   resources/sdk/{package.json,src/*.ts}  the SDK (`@zcag/pal`): the host
#                                          imports it by relative path and
#                                          links it into every user root
#   resources/extensions/<name>/           each extension in extensions/bundled.txt,
#                                          built by pal-pack (sdk/bin/pal-pack.ts)
#                                          exactly as a registry package is:
#                                          index.js (+ chunks), pal.json with
#                                          `protocol` stamped, a game's surface/
#                                          and the sources it imports, and
#                                          .pal-build.json {hash, seq, commit,
#                                          protocol}, which the core compares
#                                          with our registry
#   resources/extensions/node_modules/@zcag/pal/  a copy of the SDK
#
# A package has `@zcag/pal` external, so an SDK change does not change every
# package, and the same build is bundled here and published to the registry
# with one hash. The import resolves at run time through the copy of the SDK
# in the bundled root's node_modules: real files, since a signed .app holds no
# symlinks (the host links the SDK into user roots instead, and leaves this
# root alone). Built from the repo root, so the source-path comments in the
# output are the same on every machine.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
out="$root/app/src-tauri/resources"
bun=${BUN:-$(command -v bun || true)}
if [ -z "$bun" ]; then
  triple=$(rustc -vV | sed -n 's/^host: //p')
  bun="$root/app/src-tauri/binaries/pal-bun-$triple"
  [ -x "$bun" ] || "$root/app/scripts/fetch-bun.sh" "$triple"
fi

# The list, comments and blank lines dropped; a name without its directory
# fails here, so the list cannot drift from the tree unnoticed.
names=$(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$root/extensions/bundled.txt" | grep -v '^$')
dirs=()
for name in $names; do
  [ -f "$root/extensions/$name/index.ts" ] || { echo "build-extensions: extensions/bundled.txt lists $name, which has no extensions/$name/index.ts" >&2; exit 1; }
  dirs+=("$root/extensions/$name")
done

# Staged in a temp dir and synced by checksum, so a file that did not change
# keeps its mtime: tauri-build watches the tree and would otherwise re-link
# the app on every build.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/host/src" "$tmp/sdk/src" "$tmp/extensions/node_modules/@zcag/pal/src"
cp "$root"/host/src/*.ts "$tmp/host/src/"
for d in "$tmp/sdk" "$tmp/extensions/node_modules/@zcag/pal"; do
  cp "$root"/sdk/package.json "$d/"
  cp "$root"/sdk/src/*.ts "$d/src/"
done
"$bun" "$root/sdk/bin/pal-pack.ts" build --dir-only --cwd "$root" --out "$tmp/extensions" "${dirs[@]}" >/dev/null
mkdir -p "$out"
rsync -rc --delete "$tmp/" "$out/"
echo "build-extensions: $(echo $names | wc -w | tr -d ' ') extensions -> $out"
