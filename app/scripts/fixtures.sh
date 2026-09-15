#!/usr/bin/env bash
# Real rows from v1 palettes as the fixture corpus (personal, gitignored).
set -euo pipefail
out=$(dirname "$0")/../fixtures/all.jsonl
: >"$out"
for p in apps bookmarks cmds ssh tabs colors chars emoji iconnerd; do
  pal list "$p" | jq -c --arg p "$p" '. + {palette: $p}' >>"$out"
done
wc -l "$out"
