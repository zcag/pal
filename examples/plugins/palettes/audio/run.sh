#!/usr/bin/env bash

# Get config
config=${_PAL_PLUGIN_CONFIG:-"{}"}

# Apply rules to transform name/icon based on regex matches
# Rules format in config: rules = [{pattern = "regex", name = "New Name", icon = "icon-name"}, ...]
apply_rules() {
  local id="$1" name="$2" icon="$3"

  # Parse rules from config
  local rules
  rules=$(echo "$config" | jq -c '.rules // []')

  if [[ "$rules" != "[]" ]]; then
    while IFS= read -r rule; do
      local pattern new_name new_icon
      pattern=$(echo "$rule" | jq -r '.pattern // ""')
      new_name=$(echo "$rule" | jq -r '.name // ""')
      new_icon=$(echo "$rule" | jq -r '.icon // ""')

      if [[ -n "$pattern" && "$name" =~ $pattern ]]; then
        [[ -n "$new_name" ]] && name="$new_name"
        [[ -n "$new_icon" ]] && icon="$new_icon"
        break
      fi
    done < <(echo "$rules" | jq -c '.[]')
  fi

  # Escape for JSON
  name=$(printf '%s' "$name" | jq -Rs '.' | sed 's/^"//;s/"$//')
  printf '{"id":"%s","name":"%s","icon":"%s"}\n' "$id" "$name" "$icon"
}

list() {
  if command -v wpctl &>/dev/null; then
    list_pipewire
  elif command -v pactl &>/dev/null; then
    list_pulseaudio
  else
    echo '{"id":"error","name":"No audio backend found","icon":"error"}' >&2
  fi
}

list_pipewire() {
  wpctl status | awk '
    /Audio/,/Video/ {
      if (/Sinks:/) { in_sinks=1; next }
      if (/Sink endpoints:/ || /Sources:/ || /^[[:space:]]*$/) { in_sinks=0 }
      if (in_sinks && /[0-9]+\./) {
        gsub(/^[[:space:]│*]+/, "")
        match($0, /^([0-9]+)\. (.+)/, arr)
        if (arr[1] && arr[2]) {
          id = arr[1]
          name = arr[2]
          gsub(/\[vol:.*\]/, "", name)
          gsub(/[[:space:]]+$/, "", name)
          printf "%s\t%s\n", id, name
        }
      }
    }
  ' | while IFS=$'\t' read -r id name; do
    apply_rules "$id" "$name" "audio-card"
  done
}

list_pulseaudio() {
  pactl list sinks short | while read -r id name _ _ _; do
    desc=$(pactl list sinks | grep -A20 "Sink #$id" | grep "Description:" | head -1 | cut -d: -f2- | xargs)
    apply_rules "$id" "$desc" "audio-card"
  done
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')

  if command -v wpctl &>/dev/null; then
    wpctl set-default "$id"
  elif command -v pactl &>/dev/null; then
    pactl set-default-sink "$id"
  fi
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
