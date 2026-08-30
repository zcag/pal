#!/usr/bin/env bash

# Calculator palette. The result is the row's title - it's the thing you read
# and the thing that gets copied; the expression you typed is the subtitle.

row() { # result, expression
  jq -cn --arg r "$1" --arg q "$2" '{
    id: $r, name: $r, subtitle: $q, result: $r,
    icon_rc: "Calculator", icon_xdg: "accessories-calculator",
    accessories: [{ text: { value: "= copy", color: "secondary" } }]
  }'
}

hint() {
  jq -cn --arg n "$1" --arg s "$2" '{
    id: ("hint:" + $n), name: $n, subtitle: $s,
    icon_rc: "Calculator", icon_xdg: "accessories-calculator"
  }'
}

list() {
  local query=""
  [[ ! -t 0 ]] && query=$(cat)

  if [[ -z "$query" ]]; then
    hint "Type an expression" "2+2 · sqrt(16) · 15% of 240"
    hint "Units and currency too" "100 USD to EUR · 12 GB to MB · 3 weeks to days"
    return
  fi

  local result
  if command -v qalc &>/dev/null; then
    result=$(qalc -t "$query" 2>/dev/null)
  elif command -v bc &>/dev/null; then
    result=$(echo "$query" | bc -l 2>/dev/null)
  else
    jq -cn '{id: "error", name: "No calculator found", subtitle: "install qalc or bc", icon_xdg: "dialog-error"}'
    return
  fi

  [[ -n "$result" ]] && row "$result" "$query"
}

pick() {
  local result
  result=$(jq -r '.result // .id')
  # The hint rows aren't answers; picking one shouldn't put text on the clipboard.
  [[ -z "$result" || "$result" == hint:* || "$result" == "error" ]] && return
  printf '%s' "$result" | pal action copy
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
