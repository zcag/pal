#!/usr/bin/env bash

# Config: bridge_ip, api_key, scenes_file (optional)

cfg() {
  echo "$_PAL_PLUGIN_CONFIG" | jq -r "$1 // empty"
}

list() {
  bridge=$(cfg '.bridge_ip')
  api_key=$(cfg '.api_key')
  scenes_file=$(cfg '.scenes_file')

  if [[ -z "$bridge" || -z "$api_key" ]]; then
    echo '{"id":"error","name":"Configure bridge_ip and api_key","icon":"dialog-error"}'
    return
  fi

  # If scenes_file is provided, use that (user's presets)
  if [[ -n "$scenes_file" && -f "$scenes_file" ]]; then
    cat "$scenes_file"
    return
  fi

  # Otherwise fetch from bridge
  curl -s "http://$bridge/api/$api_key/scenes" | jq -c '
    to_entries[] | {
      id: .key,
      name: .value.name,
      group: .value.group,
      icon: "lightbulb"
    }
  '
}

pick() {
  item=$(cat)
  scene_id=$(echo "$item" | jq -r '.id')
  group=$(echo "$item" | jq -r '.group // "0"')

  bridge=$(cfg '.bridge_ip')
  api_key=$(cfg '.api_key')

  if [[ -z "$bridge" || -z "$api_key" || -z "$scene_id" ]]; then
    return
  fi

  # Activate scene
  curl -s -X PUT "http://$bridge/api/$api_key/groups/$group/action" \
    -d "{\"scene\":\"$scene_id\"}" >/dev/null
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
