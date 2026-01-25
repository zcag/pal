#!/usr/bin/env bash

list() {
  cfg=$(cat)
  data=$(jq -r '.data' <<< "$cfg")
  cat "$data"
}

pick() {
  item=$(cat)
  cmd=$(jq -r '.cmd' <<< "$item")
  bash -c "$cmd"
}

CMD=$1; shift;
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) printf "Command not found: $CMD" ;;
esac
