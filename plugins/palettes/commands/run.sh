#!/usr/bin/env bash

list() {
  cfg=$(cat)
  data=$(jq -r '.data' <<< "$cfg")
  cat "$data"
}

pick() {
  bash -c "$(jq '.url' <<< $cfg)"
}

CMD=$1; shift;
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) printf "Command not found: $CMD" ;;
esac
