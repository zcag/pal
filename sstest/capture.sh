#!/usr/bin/env bash
set -euo pipefail

OUT=/work/out
mkdir -p "$OUT"

# ── Format items for rofi dmenu (name + desc + icon metadata) ─────
# Rofi dmenu format: "display text\0icon\x1ficon-name"
format_rofi() {
  jq -r '"<b>" + .name + "</b>  <span alpha=\"50%\">" + .desc + "</span>\u0000icon\u001f" + .icon' /work/items.jsonl
}

# Format items for fzf (nerd font icon + name + desc)
format_fzf() {
  jq -r '(.icon_utf // "●") + "  " + .name + "  " + .desc' /work/items.jsonl
}

# Start virtual display
Xvfb :99 -screen 0 1280x720x24 -ac &
XVFB_PID=$!
sleep 1
export DISPLAY=:99

# Fix xdotool keyboard on Xvfb
setxkbmap us

# Start minimal WM
openbox &
sleep 0.5

echo "=== Display ready ==="

# ── Test 1: Rofi screenshot (filtered) ───────────────────────────
echo "[1] Rofi filtered..."
format_rofi | rofi -dmenu -i -p "pal" -show-icons -markup-rows -theme /work/rofi-theme.rasi &
ROFI_PID=$!
sleep 1

xdotool type --delay 80 "fire"
sleep 0.5

scrot "$OUT/rofi-filter.png"
echo "    saved rofi-filter.png"

kill $ROFI_PID 2>/dev/null || true
sleep 0.3

# ── Test 2: Rofi screenshot (full list) ──────────────────────────
echo "[2] Rofi full list..."
format_rofi | rofi -dmenu -i -p "pal" -show-icons -markup-rows -theme /work/rofi-theme.rasi &
ROFI_PID=$!
sleep 1

scrot "$OUT/rofi-full.png"
echo "    saved rofi-full.png"

kill $ROFI_PID 2>/dev/null || true
sleep 0.3

# ── Test 3: Rofi GIF (type + browse) ────────────────────────────
echo "[3] Rofi GIF..."
format_rofi | rofi -dmenu -i -p "pal" -show-icons -markup-rows -theme /work/rofi-theme.rasi &
ROFI_PID=$!
sleep 0.5

# Record
ffmpeg -f x11grab -video_size 1280x720 -framerate 15 -i :99 -y /tmp/rofi.mp4 &
FF_PID=$!
sleep 0.5

xdotool type --delay 120 "kit"
sleep 0.8
# Clear and try another
xdotool key ctrl+a
sleep 0.2
xdotool key BackSpace
sleep 0.3
xdotool type --delay 120 "disc"
sleep 0.8
xdotool key Down
sleep 0.4
xdotool key Return
sleep 0.5

kill $FF_PID 2>/dev/null || true
wait $FF_PID 2>/dev/null || true
kill $ROFI_PID 2>/dev/null || true
sleep 0.3

# Convert to gif
ffmpeg -i /tmp/rofi.mp4 \
  -vf "fps=12,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  -y "$OUT/rofi-demo.gif"
echo "    saved rofi-demo.gif"

# ── Test 4: fzf in xterm ────────────────────────────────────────
echo "[4] fzf in xterm..."
xterm -fa "FiraCode Nerd Font" -fs 11 -bg "#303446" -fg "#c6d0f5" \
  -geometry 100x25+100+100 \
  -e bash -c 'format_fzf() { jq -r "(.icon_utf // \"●\") + \"  \" + .name + \"  \" + .desc" /work/items.jsonl; }; format_fzf | fzf --prompt="pal> " --color=bg:#303446,fg:#c6d0f5,hl:#8caaee,bg+:#414559,fg+:#c6d0f5,hl+:#8caaee,info:#ca9ee6,prompt:#8caaee,pointer:#f2d5cf,marker:#a6d189 || sleep 999' &
XTERM_PID=$!
sleep 1.5

xdotool type --delay 80 "fi"
sleep 0.5
scrot "$OUT/fzf-filter.png"
echo "    saved fzf-filter.png"

kill $XTERM_PID 2>/dev/null || true

# ── Done ─────────────────────────────────────────────────────────
echo ""
echo "=== All captures in $OUT/ ==="
ls -la "$OUT/"

kill $XVFB_PID 2>/dev/null || true
