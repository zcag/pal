#!/usr/bin/env bash

list() {
  if ! command -v nmcli &>/dev/null; then
    echo '{"id":"error","name":"nmcli not found","icon":"error"}'
    return
  fi

  # Rescan networks
  nmcli device wifi rescan 2>/dev/null

  # List networks
  nmcli -t -f SSID,SIGNAL,SECURITY,IN-USE device wifi list | while IFS=: read -r ssid signal security in_use; do
    [[ -z "$ssid" ]] && continue

    # Mark currently connected
    name="$ssid"
    icon="network-wireless"
    [[ "$in_use" == "*" ]] && name="$ssid (connected)" && icon="network-wireless-connected"
    [[ -n "$security" ]] && icon="network-wireless-encrypted"

    # Escape for JSON
    ssid_escaped=$(echo "$ssid" | jq -Rs '.' | sed 's/^"//;s/"$//')
    name_escaped=$(echo "$name" | jq -Rs '.' | sed 's/^"//;s/"$//')

    echo "{\"id\":\"$ssid_escaped\",\"name\":\"$name_escaped ($signal%)\",\"signal\":$signal,\"security\":\"$security\",\"icon\":\"$icon\"}"
  done | sort -t: -k3 -rn | uniq
}

pick() {
  item=$(cat)
  ssid=$(echo "$item" | jq -r '.id')

  if [[ -z "$ssid" ]]; then
    return
  fi

  # Try to connect (will prompt for password if needed)
  nmcli device wifi connect "$ssid"
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
