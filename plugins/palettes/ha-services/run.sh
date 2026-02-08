#!/usr/bin/env bash

HA="${HA_SERVER:?HA_SERVER not set}"
TOKEN="${HA_TOKEN:?HA_TOKEN not set}"

ha() { curl -sf -H "Authorization: Bearer $TOKEN" "$HA/api/$1"; }
ha_post() { curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$2" "$HA/api/$1"; }

list_entities() {
  ha states | jq -c '.[] | {
    id: .entity_id,
    name: (.attributes.friendly_name // .entity_id),
    desc: (.state + " — " + (.entity_id | split(".")[0]))
  }'
}

list_services() {
  domain="${_HA_ENTITY%%.*}"
  ha services | jq -c --arg d "$domain" '
    .[] | select(.domain == $d) | .services | to_entries[] | {
      id: .key,
      name: .key,
      desc: (.value.description // ""),
      fields: .value.fields
    }'
}

pick_entity() { _HA_ENTITY="$PAL_ID" pal run; }

pick_service() {
  domain="${_HA_ENTITY%%.*}"
  data="{\"entity_id\":\"$_HA_ENTITY\"}"

  if [[ -n "$PAL_FIELDS" ]] && [[ "$PAL_FIELDS" != "{}" ]] && [[ "$PAL_FIELDS" != "null" ]]; then
    prompts=$(echo "$PAL_FIELDS" | jq -c '[
      to_entries[]
      | select(.value.required == true or .value.example != null)
      | if .value.selector and (.value.selector | keys[0]) == "select" then
          {key: .key, message: (.value.description // .key), type: "choice",
           options: .value.selector.select.options}
        else
          {key: .key, message: (.value.description // .key), type: "text"}
        end
    ]')

    if [[ "$prompts" != "[]" ]] && [[ "$prompts" != "null" ]]; then
      values=$(echo "$prompts" | pal prompt)
      [[ -z "$values" ]] && return
      data=$(echo "$data" | jq --argjson v "$(echo "$values" | jq -c 'if type == "object" then . else {value: .} end')" '. + $v')
    fi
  fi

  ha_post "services/$domain/$PAL_ID" "$data"
  notify-send -t 2000 "$_HA_ENTITY" "Called $domain.$PAL_ID"
}

list() { [[ -n "$_HA_ENTITY" ]] && list_services || list_entities; }
pick() { [[ -z "$_HA_ENTITY" ]] && pick_entity || pick_service; }

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
esac
