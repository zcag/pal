#!/usr/bin/env bash
# `make shots [EXT="a b"]`: the store screenshots (docs/design/screenshots.md).
#   1. each extension's fixture.ts, twice: a fixture that differs between the
#      runs reads a clock, a port or a random number, and fails here;
#   2. the gallery's Vite server (one of its own on 1430 if none is up);
#   3. shots.mjs: every shot both themes, the list in pal.json, the stamp;
#   4. a contact sheet per extension under $TMPDIR/pal-shots/, to look at.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
exts=${EXT:-}
if [ -z "$exts" ]; then
  exts=$(ls app/src/gallery/shots/*.json | xargs -n1 basename | sed 's/\.json$//; s/^bar-//' | sort -u | while read -r e; do [ -d "extensions/$e" ] && echo "$e"; done | tr '\n' ' ')
fi

# playwright-core's own browser, fetched once (never the daily Chrome).
(cd app && npx --no-install playwright-core install chromium >/dev/null)

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"; [ -n "${vite:-}" ] && kill "$vite" 2>/dev/null || true' EXIT
fail=0
for e in $exts; do
  f="extensions/$e/fixture.ts"
  [ -f "$f" ] || continue
  bun run "$f" >/dev/null || { echo "$f: failed"; fail=1; continue; }
  for j in "app/src/gallery/shots/$e.json" "app/src/gallery/shots/bar-$e.json"; do [ -f "$j" ] && cp "$j" "$scratch/$(basename "$j")"; done
  bun run "$f" >/dev/null
  for j in "app/src/gallery/shots/$e.json" "app/src/gallery/shots/bar-$e.json"; do
    [ -f "$j" ] && ! cmp -s "$j" "$scratch/$(basename "$j")" && { echo "$j: not the same on a second run (a clock, a port or a random number leaks in; app/scripts/fixture-kit.ts)"; fail=1; }
  done
done
[ "$fail" = 0 ] || exit 1

if ! curl -s -o /dev/null http://127.0.0.1:1430/; then
  (cd app && npx vite --port 1430 --strictPort >"$scratch/vite.log" 2>&1) &
  vite=$!
  for _ in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:1430/ && break; sleep 0.5; done
fi
# shellcheck disable=SC2086
node app/scripts/shots.mjs $exts

sheets="${TMPDIR:-/tmp}/pal-shots"
mkdir -p "$sheets"
if command -v montage >/dev/null; then
  for e in $exts; do
    d="extensions/$e/screenshots"
    ls "$d"/*.png >/dev/null 2>&1 || continue
    montage "$d"/*.png -tile 4x -geometry 480x+6+6 -background "#8a8a8a" "$sheets/$e.png" 2>/dev/null || true
  done
  echo "contact sheets: $sheets/<extension>.png (look at every one)"
fi
