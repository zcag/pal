#!/usr/bin/env bash

list() {
  if command -v cliphist &>/dev/null; then
    list_cliphist
  elif command -v clipman &>/dev/null; then
    list_clipman
  else
    echo '{"id":"error","name":"No clipboard manager found (cliphist/clipman)","icon":"dialog-error"}'
  fi
}

list_cliphist() {
  cliphist list | head -100 | while IFS=$'\t' read -r id content; do
    [[ -z "$id" ]] && continue
    content=$(printf '%s' "${content:0:80}" | jq -Rs '.' | sed 's/^"//;s/"$//')
    echo "{\"id\":\"$id\",\"name\":\"$content\",\"icon\":\"edit-paste\"}"
  done
}

list_clipman() {
  clipman show-history 2>/dev/null | jq -c 'to_entries | .[] | {id: .key|tostring, name: .value[0:80], icon: "edit-paste"}'
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')

  if command -v cliphist &>/dev/null; then
    cliphist decode "$id" | wl-copy
  elif command -v clipman &>/dev/null; then
    # Clipman pick by index
    clipman show-history 2>/dev/null | jq -r ".[$id]" | wl-copy
  fi

  # Notify
  if command -v notify-send &>/dev/null; then
    notify-send -t 2000 "Clipboard" "Pasted from history"
  fi
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
