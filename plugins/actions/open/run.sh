#!/usr/bin/env bash

run() {
  url=$(cat)
  if command -v xdg-open &>/dev/null; then
    xdg-open "$url"
  elif command -v open &>/dev/null; then
    open "$url"
  fi
}

CMD=$1; shift
case "$CMD" in
  run) run ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
