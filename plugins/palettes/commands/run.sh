#!/usr/bin/env bash

list() {
  data=$(jq -r '.data' <<< "$_PAL_PLUGIN_CONFIG")
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
