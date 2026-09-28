#!/usr/bin/env bash
# The gallery's bar strips beside what the real bars draw, by eye
# (docs/design/screenshots.md, "Parity"): for each named extension's bar
# fixture, the menu bar's real status-item picture (parity.rs
# `dump_menubar_pictures`) and the item as a real sketchybar draws the
# renderer's own properties (pushed as temporary `zz.parity.*` items, captured
# by their bounds, removed), each over the gallery's version, dark theme.
#
#   app/scripts/bar-real.sh privacy timer github     # macOS, sketchybar running, the gallery on :1430
#
# Sheets land in $TMPDIR/pal-bar-real/<extension>.png: real above, gallery below.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
[ $# -gt 0 ] || { echo "usage: bar-real.sh <extension>..."; exit 2; }
out="${TMPDIR:-/tmp}/pal-bar-real"
rm -rf "$out"; mkdir -p "$out/menubar"
PAL_PARITY_DUMP="$out/menubar" cargo test -q -p pal dump_menubar_pictures -- --ignored >/dev/null
curl -s -o /dev/null http://127.0.0.1:1430/ || { echo "the gallery is not up: (cd app && npx vite --port 1430)"; exit 1; }

for e in "$@"; do
  key=$(jq -r .key "app/src/gallery/shots/bar-$e.json")
  # The renderer's sketchybar properties for the fixture's item (bar-parity.json, default look, dark), as temporary items.
  mapfile -t items < <(jq -c --arg n "bar-$e" '.cases[] | select(.name == $n and .look == "default") | .dark.sketchybar[]' app/src/ui/__tests__/bar-parity.json)
  [ ${#items[@]} -gt 0 ] || { echo "bar-$e: not in bar-parity.json (PAL_UPDATE_PARITY=1 cargo test -p pal parity)"; continue; }
  args=(); names=()
  for i in "${!items[@]}"; do
    n="zz.parity.$e.$i"; names+=("$n")
    mapfile -t props < <(jq -r 'to_entries[] | "\(.key)=\(.value)"' <<<"${items[$i]}")
    args+=(--add item "$n" left --set "$n" "${props[@]}")
  done
  # Where they land: the bar before and after, cut to what changed (sketchybar leaves an item's bounds empty unless it tracks the mouse).
  h=$(sketchybar --query bar | jq '.height')
  # A region capture: a whole-screen one leaves the notched display's menu bar rows black.
  w=$(osascript -l JavaScript -e 'ObjC.import("AppKit"); $.NSScreen.mainScreen.frame.size.width')
  screencapture -x -R"0,0,$w,$h" "$out/before.png"
  # A locked or sleeping display captures black: nothing to compare then.
  [ "$(magick "$out/before.png" -format "%[fx:round(mean*1000)]" info:)" -gt 5 ] || { echo "the bar captures black: is the display asleep or locked?"; exit 1; }
  sketchybar "${args[@]}"
  sleep 1.5
  screencapture -x -R"0,0,$w,$h" "$out/after.png"
  box=$(magick "$out/before.png" "$out/after.png" -compose difference -composite -threshold 8% -format "%@" info:)
  [ "${box%%x*}" -gt 40 ] || echo "bar-$e: only $box changed on the bar; the items may not have drawn"
  magick "$out/after.png" -crop "$box" +repage -bordercolor '#2c2c30' -border 12 "$out/sk-real.png"
  sketchybar $(printf -- '--remove %s ' "${names[@]}")
  # The gallery's two strips for the same item, cut to it.
  node --input-type=module -e "
    import { chromium } from '$root/app/node_modules/playwright-core/index.mjs';
    const b = await chromium.launch();
    for (const t of ['menubar', 'sketchybar']) {
      const p = await b.newPage({ viewport: { width: 720, height: 60 }, deviceScaleFactor: 2 });
      await p.goto('http://127.0.0.1:1430/?gallery&bar=$key&target=' + t + '&theme=dark', { waitUntil: 'networkidle' });
      await p.waitForSelector('html[data-ready]'); await p.waitForTimeout(300);
      const r = await p.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [b.x, b.width]; }, t === 'menubar' ? '.g-mb__pal' : '.g-sb__group');
      await p.screenshot({ path: '$out/' + t + '-mock.png', clip: { x: Math.max(0, r[0] - 6), y: 0, width: r[1] + 12, height: t === 'menubar' ? 24 : 26 } });
    }
    await b.close();"
  real_mb=$(ls "$out/menubar/bar-$e-dark"*.png | head -1)
  if [[ $real_mb == *template* ]]; then magick "$real_mb" -channel RGB -negate +channel -background '#2c2c30' -flatten -bordercolor '#2c2c30' -border 12 "$out/mb-real.png"
  else magick "$real_mb" -background '#2c2c30' -flatten -bordercolor '#2c2c30' -border 12 "$out/mb-real.png"; fi
  magick "$out/mb-real.png" "$out/menubar-mock.png" "$out/sk-real.png" "$out/sketchybar-mock.png" -background '#777' -gravity west -splice 0x6 -append "$out/$e.png"
  echo "$out/$e.png"
done
