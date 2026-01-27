#!/usr/bin/env bash

list() {
  # Public IP
  public_ip=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || curl -s --max-time 3 icanhazip.com 2>/dev/null || echo "unavailable")
  echo "{\"id\":\"$public_ip\",\"name\":\"Public IP: $public_ip\",\"icon\":\"network-wired\",\"desc\":\"external address\"}"

  # Local IPs from all interfaces
  if command -v ip &>/dev/null; then
    ip -4 addr show 2>/dev/null | awk '/inet / && !/127.0.0.1/ {
      gsub(/\/.*/, "", $2)
      iface = $NF
      print "{\"id\":\"" $2 "\",\"name\":\"" iface ": " $2 "\",\"icon\":\"network-wired\",\"desc\":\"local address\"}"
    }'
  elif command -v ifconfig &>/dev/null; then
    ifconfig 2>/dev/null | awk '/inet / && !/127.0.0.1/ {
      gsub(/addr:/, "", $2)
      print "{\"id\":\"" $2 "\",\"name\":\"Local: " $2 "\",\"icon\":\"network-wired\",\"desc\":\"local address\"}"
    }'
  fi

  # Default gateway
  if command -v ip &>/dev/null; then
    gateway=$(ip route | awk '/default/ {print $3; exit}')
    [[ -n "$gateway" ]] && echo "{\"id\":\"$gateway\",\"name\":\"Gateway: $gateway\",\"icon\":\"network-server\",\"desc\":\"default route\"}"
  fi

  # DNS servers
  if [[ -f /etc/resolv.conf ]]; then
    grep -E '^nameserver' /etc/resolv.conf | head -3 | while read -r _ dns; do
      echo "{\"id\":\"$dns\",\"name\":\"DNS: $dns\",\"icon\":\"network-server\",\"desc\":\"nameserver\"}"
    done
  fi

  # Hostname
  hostname=$(hostname 2>/dev/null)
  [[ -n "$hostname" ]] && echo "{\"id\":\"$hostname\",\"name\":\"Hostname: $hostname\",\"icon\":\"computer\",\"desc\":\"this machine\"}"
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')

  # Copy to clipboard
  if command -v wl-copy &>/dev/null; then
    printf '%s' "$id" | wl-copy
  elif command -v xclip &>/dev/null; then
    printf '%s' "$id" | xclip -selection clipboard
  fi

  # Notify
  if command -v notify-send &>/dev/null; then
    notify-send -t 2000 "Copied" "$id"
  fi
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
