#!/usr/bin/env bash

# Paired devices, connected ones first, and picking one toggles it. BlueZ on
# Linux, blueutil on macOS - each list_<backend> only has to emit
# `address<TAB>name<TAB>connected`, and the row and the ordering are shared.

row() { # address, name, connected(0|1)
  jq -cn --arg id "$1" --arg name "$2" --argjson on "${3:-0}" '
    {
      id: $id, name: $name, mac: $id, subtitle: $id,
      keywords: [$name, "bluetooth", "ble"]
    }
    + (if $on == 1
       then { icon_xdg: "bluetooth-connected", icon_rc: "BluetoothConnected", icon_utf: "󰂱",
              accessories: [{ tag: { value: "connected", color: "green" } }] }
       else { icon_xdg: "bluetooth", icon_rc: "Bluetooth", icon_utf: "󰂯" }
       end)'
}

# Connected first - it is the half of the list you act on, and on either
# backend the native order is arbitrary.
emit() {
  sort -t$'\t' -k3,3r -k2,2 \
    | while IFS=$'\t' read -r mac name connected; do row "$mac" "$name" "$connected"; done
}

# bluetoothctl blocks forever on a machine with no adapter rather than
# returning empty, and `requires` only proves the binary exists - so the
# adapter, not bluetoothctl, is what decides whether BlueZ is the backend.
has_adapter() { [[ -n "$(ls -A /sys/class/bluetooth 2>/dev/null)" ]]; }

backend() {
  if command -v bluetoothctl &>/dev/null && has_adapter; then echo bluez
  elif command -v blueutil &>/dev/null; then echo blueutil
  fi
}

list() {
  case "$(backend)" in
    bluez)    list_bluez | emit ;;
    blueutil) list_blueutil | emit ;;
    *) echo '{"id":"error","name":"No bluetooth adapter found","icon_xdg":"dialog-error"}' >&2 ;;
  esac
}

list_bluez() {
  # Still time-boxed: an adapter that is present but wedged hangs the same way.
  timeout 5 bluetoothctl devices 2>/dev/null | while read -r _ mac name; do
    [[ -z "$mac" || -z "$name" ]] && continue
    connected=0
    timeout 5 bluetoothctl info "$mac" 2>/dev/null | grep -q "Connected: yes" && connected=1
    printf '%s\t%s\t%s\n' "$mac" "$name" "$connected"
  done
}

list_blueutil() {
  blueutil --paired --format json \
    | jq -r '.[] | [.address, .name, (if .connected then "1" else "0" end)] | @tsv'
}

connected() { # address -> exit 0 if connected
  if [[ "$(backend)" == bluez ]]; then
    timeout 5 bluetoothctl info "$1" 2>/dev/null | grep -q "Connected: yes"
  else
    [[ "$(blueutil --is-connected "$1" 2>/dev/null)" == 1 ]]
  fi
}

pick() {
  item=$(cat)
  mac=$(echo "$item" | jq -r '.mac')
  name=$(echo "$item" | jq -r '.name')
  [[ -z "$mac" || "$mac" == "null" ]] && return

  # Re-read rather than trust the row - the list may have been on screen a while.
  if connected "$mac"; then
    action=disconnect verb=Disconnected
  else
    action=connect verb=Connected
  fi

  if [[ "$(backend)" == bluez ]]; then
    bluetoothctl "$action" "$mac" >/dev/null
  else
    blueutil "--$action" "$mac"
  fi

  jq -cn --arg v "$verb" --arg n "$name" '{hud: ($v + " " + $n), close: true}'
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
