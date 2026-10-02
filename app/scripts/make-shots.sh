#!/usr/bin/env bash
# `make shots [EXT="a b"]`: the store screenshots (docs/design/screenshots.md).
#   1. each extension's fixture.ts, twice: a fixture that differs between the
#      runs reads a clock, a port or a random number, and fails here;
#   2. a private Vite server for the gallery (no hot reload, a free port);
#   3. shots.mjs: every shot both themes, the list in pal.json, the stamp;
#   4. a contact sheet per extension under $TMPDIR/pal-shots/, to look at.
# DESIGN=<id> renders every shot in that built-in design (general.design) into
# $TMPDIR/pal-shots-<id>/ instead, with its sheets there: nothing in the repo
# changes, the store's pictures stay pal's own design.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
exts=${EXT:-}
design=${DESIGN:-}
if [ -z "$exts" ]; then
  exts=$(ls app/src/gallery/shots/*.json | xargs -n1 basename | sed 's/\.json$//; s/^bar-//' | sort -u | while read -r e; do [ -d "extensions/$e" ] && echo "$e"; done | tr '\n' ' ')
fi

# pngquant quantises every picture alike on every machine (shot-quant.py).
command -v pngquant >/dev/null || { echo "make shots needs pngquant: brew install pngquant"; exit 1; }

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

# A private gallery server: no hot reload, no watcher (PAL_SHOTS), on a free port, so a fixture another run writes cannot reload the page mid-shot.
port=$(node -e 'const s = require("net").createServer().listen(0, () => { console.log(s.address().port); s.close(); })')
# exec: `$!` is then vite itself, so the trap's kill reaches it (through npx it left an orphan server per run).
(cd app && PAL_SHOTS=1 exec node_modules/.bin/vite --port "$port" --strictPort >"$scratch/vite.log" 2>&1) &
vite=$!
for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.5; done
export SHOTS_URL="http://127.0.0.1:$port"
if [ -n "$design" ]; then
  export SHOTS_DESIGN="$design" SHOTS_OUT="${TMPDIR:-/tmp}/pal-shots-$design"
  mkdir -p "$SHOTS_OUT"
fi
# shellcheck disable=SC2086
node app/scripts/shots.mjs $exts

sheets="${TMPDIR:-/tmp}/pal-shots${design:+-$design}"
mkdir -p "$sheets"
if command -v montage >/dev/null; then
  for e in $exts; do
    if [ -n "$design" ]; then set -- "$sheets/$e"-*.png; else set -- "extensions/$e/screenshots"/*.png; fi
    [ -e "$1" ] || continue
    montage "$@" -tile 4x -geometry 480x+6+6 -background "#8a8a8a" "$sheets/$e.png" 2>/dev/null || true
  done
  echo "contact sheets: $sheets/<extension>.png (look at every one)"
fi
