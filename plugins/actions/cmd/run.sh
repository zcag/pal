#!/usr/bin/env bash

# receives command to execute via stdin
run() {
  cmd=$(cat)
  bash -c "$cmd"
}

CMD=$1; shift
case "$CMD" in
  run) run ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
