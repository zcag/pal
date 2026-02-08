#!/usr/bin/env bash

HA="${HA_SERVER:?HA_SERVER not set}"
TOKEN="${HA_TOKEN:?HA_TOKEN not set}"

ha() { curl -sf -H "Authorization: Bearer $TOKEN" "$HA/api/$1"; }

list_entities() {
  ha states | jq -c '.[] | {
    id: .entity_id,
    name: (.attributes.friendly_name // .entity_id),
    desc: (.state + " — " + (.entity_id | split(".")[0]))
  }'
}

list_attrs() {
  ha "states/$_HA_ENTITY" | jq -c '
    [{ id: "state", name: "state", desc: .state, value: .state }] +
    [.attributes | to_entries[] | { id: .key, name: .key, desc: (.value|tostring), value: (.value|tostring) }]
    | .[]'
}

pick_entity() { _HA_ENTITY="$PAL_ID" pal run; }
pick_attr() {
  [[ -n "$PAL_VALUE" ]] && printf '%s' "$PAL_VALUE" | pal action copy
}

list() { [[ -n "$_HA_ENTITY" ]] && list_attrs || list_entities; }
pick() { [[ -z "$_HA_ENTITY" ]] && pick_entity || pick_attr; }

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
esac
