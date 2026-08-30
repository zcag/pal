#!/usr/bin/env bash

HA="${HA_SERVER:?HA_SERVER not set}"
TOKEN="${HA_TOKEN:?HA_TOKEN not set}"

ha() { curl -sf -H "Authorization: Bearer $TOKEN" "$HA/api/$1"; }
ha_post() { curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$2" "$HA/api/$1"; }

list_entities() {
  ha states | jq -c --arg scope "${PAL_FILTER:-all}" '
    def domain: .entity_id | split(".")[0];
    # Raycast has a glyph for most of what HA models; a bare dot for the rest.
    def glyph: {
      light: "LightBulb", switch: "Switch", input_boolean: "Switch", fan: "Wind",
      sensor: "Gauge", binary_sensor: "Gauge", number: "Hashtag",
      climate: "Temperature", weather: "CloudSun", sun: "Sun",
      media_player: "Music", camera: "Camera", cover: "AppWindow", lock: "Lock",
      person: "Person", device_tracker: "Person", zone: "Geopin",
      script: "Code", automation: "Bolt", scene: "Stars", button: "Circle",
      calendar: "Calendar", event: "Bell", todo: "CheckList", update: "Download",
      vacuum: "Trash", select: "List", conversation: "SpeechBubble"
    }[domain] // "Dot";
    def tone:
      if . == "unavailable" or . == "unknown" then "red"
      elif . == "on" or . == "home" or . == "open" or . == "playing" or . == "heat" then "green"
      elif . == "off" or . == "not_home" or . == "closed" or . == "idle" then "secondary"
      else "blue" end;

    .[]
    | select($scope == "all" or domain == $scope)
    | (.state + (if .attributes.unit_of_measurement then " " + .attributes.unit_of_measurement else "" end)) as $state
    | {
        id: .entity_id,
        name: (.attributes.friendly_name // .entity_id),
        subtitle: .entity_id,
        keywords: [.entity_id, domain],
        section: domain,
        icon_rc: glyph,
        icon_xdg: "home",
        value: .state,
        accessories: [{ tag: { value: $state[0:28], color: (.state | tone) } }]
      }'
}

# A pick that resolves to another palette is a drill-down; the frontend pushes
# a view (Raycast) or re-enters (terminal). This used to call `pal run`, which
# spawns a *frontend* and so only ever worked in a terminal.
list_services() {
  domain="${_HA_ENTITY%%.*}"
  ha services | jq -c --arg d "$domain" '
    .[] | select(.domain == $d) | .services | to_entries[] | {
      id: .key,
      name: (.value.name // .key),
      subtitle: (.value.description // ""),
      keywords: [.key, ($d + "." + .key)],
      icon_rc: "Bolt",
      accessories: [{ text: { value: ($d + "." + .key), color: "secondary" } }],
      fields: .value.fields
    }'
}

pick_entity() {
  jq -cn --arg entity "$PAL_ID" --arg palette "${_PAL_PALETTE:-ha-states}" \
    '{palette: $palette, env: { _HA_ENTITY: $entity }}'
}

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

  ha_post "services/$domain/$PAL_ID" "$data" >/dev/null
  # An envelope reaches every frontend; notify-send reached exactly one.
  jq -cn --arg t "Called $domain.$PAL_ID" '{hud: $t, close: true}'
}

list() { [[ -n "$_HA_ENTITY" ]] && list_services || list_entities; }
pick() { [[ -z "$_HA_ENTITY" ]] && pick_entity || pick_service; }

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
esac
