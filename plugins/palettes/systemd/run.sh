#!/usr/bin/env bash

list() {
  # List user services by default, can be configured via PAL config
  cfg=$(echo "$_PAL_PLUGIN_CONFIG" | jq -r '.')
  scope=$(echo "$cfg" | jq -r '.scope // "user"')

  if [[ "$scope" == "system" ]]; then
    systemctl list-units --type=service --all --no-pager --plain | tail -n +2 | head -n -5
  else
    systemctl --user list-units --type=service --all --no-pager --plain | tail -n +2 | head -n -5
  fi | while read -r unit load active sub desc; do
    [[ -z "$unit" ]] && continue

    icon="service"
    [[ "$active" == "active" ]] && icon="service-running"
    [[ "$active" == "failed" ]] && icon="service-failed"

    # Escape description for JSON
    desc_escaped=$(echo "$desc" | jq -Rs '.' | sed 's/^"//;s/"$//')

    echo "{\"id\":\"$unit\",\"name\":\"$unit\",\"status\":\"$active/$sub\",\"desc\":\"$desc_escaped\",\"icon\":\"$icon\"}"
  done
}

pick() {
  item=$(cat)
  unit=$(echo "$item" | jq -r '.id')

  cfg=$(echo "$_PAL_PLUGIN_CONFIG" | jq -r '.')
  scope=$(echo "$cfg" | jq -r '.scope // "user"')
  action=$(echo "$cfg" | jq -r '.action // "restart"')

  if [[ "$scope" == "system" ]]; then
    sudo systemctl "$action" "$unit"
  else
    systemctl --user "$action" "$unit"
  fi
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
