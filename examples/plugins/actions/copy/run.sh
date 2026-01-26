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
}

CMD=$1; shift
case "$CMD" in
  run) run ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
