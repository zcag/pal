#!/usr/bin/env bash

run() {
  items=$(cat)

  selected=$(echo "$items" | jq -r '.name' | vicinae dmenu -p "pal")

  if [[ -n "$selected" ]]; then
    escaped=$(printf '%s' "$selected" | jq -Rs '.')
    echo "$items" | jq -c "select(.name == $escaped)"
  fi
}

CMD=$1; shift
case "$CMD" in
  run) run ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
