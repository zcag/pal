#!/usr/bin/env bash

# Every row is one address you might want to paste somewhere: the label is the
# title, the address itself is the tag you copy.

emit() { # label, value, section, icon
  [[ -z "$2" ]] && return
  jq -cn --arg n "$1" --arg v "$2" --arg s "$3" --arg i "$4" '{
    id: $v, name: $n, value: $v, section: $s,
    icon_rc: $i, icon_xdg: "network-wired", keywords: [$v],
    accessories: [{ tag: { value: $v, color: "blue" } }]
  }'
}

list() {
  emit "Public IP" \
    "$(curl -s --max-time 3 ifconfig.me 2>/dev/null || curl -s --max-time 3 icanhazip.com 2>/dev/null)" \
    "Internet" "Globe"

  # `ip` on Linux, `ifconfig` everywhere else - both give interface + address.
  if command -v ip &>/dev/null; then
    ip -4 -o addr show 2>/dev/null | awk '$4 !~ /^127\./ {gsub(/\/.*/, "", $4); print $2, $4}'
  else
    ifconfig 2>/dev/null | awk '
      /^[a-z]/ { iface = substr($1, 1, length($1) - 1) }
      /inet / && $2 !~ /^127\./ { print iface, $2 }'
  fi | while read -r iface addr; do
    emit "$iface" "$addr" "This machine" "Network"
  done

  if command -v ip &>/dev/null; then
    emit "Gateway" "$(ip route 2>/dev/null | awk '/default/ {print $3; exit}')" "Network" "HardDrive"
  else
    emit "Gateway" "$(route -n get default 2>/dev/null | awk '/gateway:/ {print $2; exit}')" "Network" "HardDrive"
  fi

  # resolv.conf is a stub on macOS; scutil is the one that knows.
  if command -v scutil &>/dev/null; then
    scutil --dns 2>/dev/null | awk '/nameserver\[[0-9]+\]/ {print $3}' | sort -u | head -3
  else
    awk '/^nameserver/ {print $2}' /etc/resolv.conf 2>/dev/null | head -3
  fi | while read -r dns; do
    emit "DNS" "$dns" "Network" "HardDrive"
  done

  emit "Hostname" "$(hostname 2>/dev/null)" "This machine" "Desktop"
}

pick() {
  jq -r '.value // .id' | pal action copy
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
