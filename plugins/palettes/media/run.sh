#!/usr/bin/env bash

# Media control palette using playerctl
# Requires: playerctl

list() {
  if ! command -v playerctl &>/dev/null; then
    echo '{"id":"error","name":"playerctl not found","icon":"dialog-error"}' >&2
    exit 1
  fi

  # Get current player info
  player=$(playerctl -l 2>/dev/null | head -1)
  status=$(playerctl status 2>/dev/null || echo "Stopped")
  title=$(playerctl metadata title 2>/dev/null || echo "Nothing playing")
  artist=$(playerctl metadata artist 2>/dev/null || echo "")

  now_playing="$title"
  [[ -n "$artist" ]] && now_playing="$artist - $title"

  # Play/Pause based on status
  if [[ "$status" == "Playing" ]]; then
    echo "{\"id\":\"play-pause\",\"name\":\"Pause\",\"desc\":\"$now_playing\",\"icon\":\"media-playback-pause\"}"
  else
    echo "{\"id\":\"play-pause\",\"name\":\"Play\",\"desc\":\"$now_playing\",\"icon\":\"media-playback-start\"}"
  fi

  echo '{"id":"next","name":"Next Track","desc":"Skip to next","icon":"media-skip-forward"}'
  echo '{"id":"prev","name":"Previous Track","desc":"Go back","icon":"media-skip-backward"}'
  echo '{"id":"stop","name":"Stop","desc":"Stop playback","icon":"media-playback-stop"}'

  # Volume controls
  echo '{"id":"vol-up","name":"Volume Up","desc":"+10%","icon":"audio-volume-high"}'
  echo '{"id":"vol-down","name":"Volume Down","desc":"-10%","icon":"audio-volume-low"}'
  echo '{"id":"vol-mute","name":"Mute","desc":"Toggle mute","icon":"audio-volume-muted"}'

  # Shuffle/Loop
  echo '{"id":"shuffle","name":"Shuffle","desc":"Toggle shuffle","icon":"media-playlist-shuffle"}'
  echo '{"id":"loop","name":"Loop","desc":"Cycle loop mode","icon":"media-playlist-repeat"}'

  # Player selection if multiple
  players=$(playerctl -l 2>/dev/null)
  if [[ $(echo "$players" | wc -l) -gt 1 ]]; then
    echo "$players" | while read -r p; do
      p_status=$(playerctl -p "$p" status 2>/dev/null || echo "stopped")
      echo "{\"id\":\"player:$p\",\"name\":\"Switch to $p\",\"desc\":\"$p_status\",\"icon\":\"multimedia-player\"}"
    done
  fi
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')

  case "$id" in
    play-pause) playerctl play-pause ;;
    next) playerctl next ;;
    prev) playerctl previous ;;
    stop) playerctl stop ;;
    vol-up) playerctl volume 0.1+ ;;
    vol-down) playerctl volume 0.1- ;;
    vol-mute)
      # Toggle mute via pactl if available, otherwise just set to 0
      if command -v pactl &>/dev/null; then
        pactl set-sink-mute @DEFAULT_SINK@ toggle
      else
        playerctl volume 0
      fi
      ;;
    shuffle) playerctl shuffle toggle ;;
    loop) playerctl loop ;;
    player:*)
      player="${id#player:}"
      # Set as default by using it
      playerctl -p "$player" play-pause
      ;;
  esac
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
