#!/usr/bin/env bash

list() {
  if ! command -v bluetoothctl &>/dev/null; then
    echo '{"id":"error","name":"bluetoothctl not found","icon":"error"}'
    return
  fi

  # List paired devices
  bluetoothctl devices 2>/dev/null | while read -r _ mac name; do
    [[ -z "$mac" || -z "$name" ]] && continue

    # Check if connected
    connected=$(bluetoothctl info "$mac" 2>/dev/null | grep "Connected: yes")
    icon="bluetooth"
    status=""
    [[ -n "$connected" ]] && icon="bluetooth-connected" && status=" (connected)"

    name_escaped=$(printf '%s' "$name$status" | jq -Rs '.' | sed 's/^"//;s/"$//')
    echo "{\"id\":\"$mac\",\"name\":\"$name_escaped\",\"mac\":\"$mac\",\"icon\":\"$icon\"}"
  done | grep -v '^$'
}

pick() {
  item=$(cat)
  mac=$(echo "$item" | jq -r '.mac')

  if [[ -z "$mac" ]]; then
    return
  fi

  # Check if connected, toggle
  connected=$(bluetoothctl info "$mac" 2>/dev/null | grep "Connected: yes")
  if [[ -n "$connected" ]]; then
    bluetoothctl disconnect "$mac"
  else
    bluetoothctl connect "$mac"
  fi
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
