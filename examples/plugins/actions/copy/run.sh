#!/usr/bin/env bash

run() {
  value=$(cat)
  if command -v wl-copy &>/dev/null; then
    printf '%s' "$value" | wl-copy
  elif command -v xclip &>/dev/null; then
    printf '%s' "$value" | xclip -selection clipboard
  elif command -v pbcopy &>/dev/null; then
    printf '%s' "$value" | pbcopy
  fi

  # Show notification
  # Truncate for display
  display="${value:0:50}"
  [[ ${#value} -gt 50 ]] && display="${display}..."
  if command -v notify-send &>/dev/null; then
    notify-send -t 2000 "Copied" "$display"
  fi
}

CMD=$1; shift
case "$CMD" in
  run) run ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
