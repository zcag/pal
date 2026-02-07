#!/usr/bin/env bash

run() {
  items=$(cat)

  # Format for rofi with icons: "display\0icon\x1ficon-name"
  # \u0000 = null byte separator, \u001f = unit separator for rofi metadata
  selected=$(echo "$items" | jq -r '"\(.name)\u0000icon\u001f\(.icon_xdg // .icon // "")"' | rofi -dmenu -i -p "pal" -show-icons)

  if [[ -n "$selected" ]]; then
    # selected is just the name, find matching item
    escaped=$(printf '%s' "$selected" | jq -Rs '.')
    echo "$items" | jq -c "select(.name == $escaped)"
  fi
}

CMD=$1; shift
case "$CMD" in
  run) run ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
