#!/usr/bin/env bash

run() {
  cfg=$(cat)
  items=$(jq -c '.items[]' <<< "$cfg")

  # display: "id\ticon name" - fzf shows only icon+name, we get id back
  selected=$(echo "$items" | jq -r '"\(.id)\t\(.icon // "") \(.name)"' | fzf --with-nth=2.. --prompt="pal> ")

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
