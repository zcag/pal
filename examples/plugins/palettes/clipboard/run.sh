#!/usr/bin/env bash

list() {
  if command -v cliphist &>/dev/null; then
    cliphist list | while IFS=$'\t' read -r id content; do
      # Escape content for JSON
      content=$(echo "$content" | head -c 100 | jq -Rs '.')
      echo "{\"id\":\"$id\",\"name\":$content,\"icon\":\"clipboard\"}"
    done
  else
    echo '{"id":"error","name":"cliphist not found","icon":"error"}'
  fi
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')

  if command -v cliphist &>/dev/null; then
    cliphist decode "$id" | wl-copy
  fi
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
