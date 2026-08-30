#!/usr/bin/env bash

# Calculator palette with qalc
# Supports live preview via frontend query

list() {
  # Get query from stdin if provided (for live preview)
  query=""
  if [[ ! -t 0 ]]; then
    query=$(cat)
  fi
  
  if [[ -z "$query" ]]; then
    # Show recent calculations or instructions
    echo '{"id":"help","name":"Type an expression to calculate...","icon":"accessories-calculator"}'
    echo '{"id":"example1","name":"Example: 2+2, sqrt(16), 100 USD to EUR","icon":"accessories-calculator"}'
    return
  fi
  
  if command -v qalc &>/dev/null; then
    result=$(qalc -t "$query" 2>/dev/null)
    if [[ -n "$result" ]]; then
      result_escaped=$(printf '%s' "$result" | jq -Rs '.' | sed 's/^"//;s/"$//')
      query_escaped=$(printf '%s' "$query" | jq -Rs '.' | sed 's/^"//;s/"$//')
      echo "{\"id\":\"$result_escaped\",\"name\":\"$query_escaped = $result_escaped\",\"icon\":\"accessories-calculator\",\"result\":\"$result_escaped\"}"
    fi
  elif command -v bc &>/dev/null; then
    result=$(echo "$query" | bc -l 2>/dev/null)
    if [[ -n "$result" ]]; then
      result_escaped=$(printf '%s' "$result" | jq -Rs '.' | sed 's/^"//;s/"$//')
      query_escaped=$(printf '%s' "$query" | jq -Rs '.' | sed 's/^"//;s/"$//')
      echo "{\"id\":\"$result_escaped\",\"name\":\"$query_escaped = $result_escaped\",\"icon\":\"accessories-calculator\",\"result\":\"$result_escaped\"}"
    fi
  else
    echo '{"id":"error","name":"No calculator found (qalc/bc)","icon":"dialog-error"}'
  fi
}

pick() {
  item=$(cat)
  result=$(echo "$item" | jq -r '.result // .id')
  
  [[ -z "$result" || "$result" == "help" || "$result" == "example1" ]] && return
  
  # `pal action copy` already walks wl-copy/pbcopy/xclip and answers with a
  # {"hud": ...} envelope, which a rich frontend renders and notify-send can't.
  printf '%s' "$result" | pal action copy
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
