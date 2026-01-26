#!/usr/bin/env bash

list() {
  if command -v wpctl &>/dev/null; then
    list_pipewire
  elif command -v pactl &>/dev/null; then
    list_pulseaudio
  else
    echo '{"id":"error","name":"No audio backend found","icon":"error"}' >&2
  fi
}

list_pipewire() {
  wpctl status | awk '
    /Audio/,/Video/ {
      if (/Sinks:/) { in_sinks=1; next }
      if (/Sink endpoints:/ || /Sources:/ || /^[[:space:]]*$/) { in_sinks=0 }
      if (in_sinks && /[0-9]+\./) {
        gsub(/^[[:space:]│*]+/, "")
        match($0, /^([0-9]+)\. (.+)/, arr)
        if (arr[1] && arr[2]) {
          id = arr[1]
          name = arr[2]
          gsub(/\[vol:.*\]/, "", name)
          gsub(/[[:space:]]+$/, "", name)
          printf "{\"id\":\"%s\",\"name\":\"%s\",\"icon\":\"audio-card\"}\n", id, name
        }
      }
    }
  '
}

list_pulseaudio() {
  pactl list sinks short | while read -r id name _ _ _; do
    desc=$(pactl list sinks | grep -A20 "Sink #$id" | grep "Description:" | head -1 | cut -d: -f2- | xargs)
    echo "{\"id\":\"$id\",\"name\":\"$desc\",\"icon\":\"audio-card\"}"
  done
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')

  if command -v wpctl &>/dev/null; then
    wpctl set-default "$id"
  elif command -v pactl &>/dev/null; then
    pactl set-default-sink "$id"
  fi
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
