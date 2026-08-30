#!/usr/bin/env bash

# The other half of `copy`. Reads nothing, prints the clipboard, so a command
# can be written once as `pal action paste | ... | pal action copy` instead of
# re-deriving which of wl-paste/pbpaste/xclip this machine has.
run() {
  cat >/dev/null   # actions are handed a value; this one has no use for it
  if command -v wl-paste &>/dev/null; then
    wl-paste
  elif command -v pbpaste &>/dev/null; then
    pbpaste
  elif command -v xclip &>/dev/null; then
    xclip -selection clipboard -o
  fi
}

CMD=$1; shift
case "$CMD" in
  run) run ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
