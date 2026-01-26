#!/usr/bin/env bash

run() {
  items=$(cat)

  # display: "id\ticon name" - rofi shows only icon+name via -display-columns
  selected=$(echo "$items" | jq -r '"\(.id)\t\(.icon // "") \(.name)"' | rofi -dmenu -i -p "pal" -display-columns 2)

  if [[ -n "$selected" ]]; then
    id=$(cut -f1 <<< "$selected")
    echo "$items" | jq -c "select(.id == \"$id\")"
  fi
}

CMD=$1; shift
case "$CMD" in
  run) run ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
