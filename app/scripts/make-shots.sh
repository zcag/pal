#!/usr/bin/env bash
# `make shots [EXT="a b"]`: the store screenshots (docs/design/screenshots.md),
# of the extensions in the extension repos (app/scripts/extension-repos.mjs:
# ../pal-extensions and ../pal-games, or PAL_EXTENSION_REPOS).
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
# <name> <dir> <shots> for every extension the repos have.
list=$(node app/scripts/extension-repos.mjs list)
at() { awk -F'\t' -v n="$1" -v c="$2" '$1 == n { print $c }' <<<"$list"; }
if [ -z "$exts" ]; then
  exts=$(while IFS=$'\t' read -r e _ s; do if [ -f "$s/$e.json" ] || [ -f "$s/bar-$e.json" ]; then echo "$e"; fi; done <<<"$list" | tr '\n' ' ')
fi

# pngquant quantises every picture alike on every machine (shot-quant.py).
command -v pngquant >/dev/null || { echo "make shots needs pngquant: brew install pngquant"; exit 1; }

# playwright-core's own browser, fetched once (never the daily Chrome).
(cd app && npx --no-install playwright-core install chromium >/dev/null)

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"; [ -n "${vite:-}" ] && kill "$vite" 2>/dev/null || true' EXIT
fail=0
for e in $exts; do
  [ -n "$(at "$e" 2)" ] || { echo "$e: no such extension in the extension repos"; fail=1; continue; }
  f="$(at "$e" 2)/fixture.ts" s=$(at "$e" 3)
  [ -f "$f" ] || continue
  bun run "$f" >/dev/null || { echo "$f: failed"; fail=1; continue; }
  for j in "$s/$e.json" "$s/bar-$e.json"; do [ -f "$j" ] && cp "$j" "$scratch/$(basename "$j")"; done
  bun run "$f" >/dev/null
  for j in "$s/$e.json" "$s/bar-$e.json"; do
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
    if [ -n "$design" ]; then set -- "$sheets/$e"-*.png; else set -- "$(at "$e" 2)/screenshots"/*.png; fi
    [ -e "$1" ] || continue
    montage "$@" -tile 4x -geometry 480x+6+6 -background "#8a8a8a" "$sheets/$e.png" 2>/dev/null || true
  done
  echo "contact sheets: $sheets/<extension>.png (look at every one)"
fi
