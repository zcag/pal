#!/usr/bin/env bash

HA="${HA_SERVER:?HA_SERVER not set}"
TOKEN="${HA_TOKEN:?HA_TOKEN not set}"

ha() { curl -sf -H "Authorization: Bearer $TOKEN" "$HA/api/$1"; }

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
list_attrs() {
  ha "states/$_HA_ENTITY" | jq -c '
    def row($k; $v; $section):
      { id: $k, name: $k, value: $v, section: $section,
        icon_rc: "Text", keywords: [$v],
        accessories: [{ tag: { value: ($v[0:40]), color: "blue" } }] };
    [row("state"; .state; "State")]
    + [.attributes | to_entries[] | row(.key; (.value | tostring); "Attributes")]
    | .[]'
}

pick_entity() {
  jq -cn --arg entity "$PAL_ID" --arg palette "${_PAL_PALETTE:-ha-states}" \
    '{palette: $palette, env: { _HA_ENTITY: $entity }}'
}
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
