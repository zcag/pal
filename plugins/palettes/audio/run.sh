#!/usr/bin/env bash

# One row per output device, the one in use tagged. Backends differ only in how
# you enumerate and how you set - PipeWire/PulseAudio on Linux,
# SwitchAudioSource on macOS - so the row is built once, here, and each
# list_<backend> only has to emit `id<TAB>name<TAB>current`.

config=${_PAL_PLUGIN_CONFIG:-"{}"}

# rules = [{pattern = "regex", name = "New Name", icon = "icon-name"}, ...]
# Renames / re-icons a device whose name matches. First match wins; `icon` is
# an xdg icon name, which is what rofi and Raycast-style frontends want.
apply_rules() { # name icon -> "name<TAB>icon"
  local name="$1" icon="$2" rules

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

  printf '%s\t%s\n' "$name" "$icon"
}

row() { # id, name, current(0|1)
  local name icon
  IFS=$'\t' read -r name icon < <(apply_rules "$2" "audio-card")

  jq -cn --arg id "$1" --arg name "$name" --arg xdg "$icon" --argjson cur "${3:-0}" '
    {
      id: $id,
      name: $name,
      keywords: [$name, "audio", "output", "sound"],
      icon_xdg: $xdg, icon_rc: "Speaker", icon_utf: "󰓃"
    }
    # The device you are already on stays listed - it is how you confirm which
    # one that is - but it should not look like somewhere to switch to.
    + (if $cur == 1 then { accessories: [{ tag: { value: "current", color: "green" } }] } else {} end)'
}

emit() { while IFS=$'\t' read -r id name cur; do row "$id" "$name" "$cur"; done; }

list() {
  if command -v wpctl &>/dev/null; then
    list_pipewire | emit
  elif command -v pactl &>/dev/null; then
    list_pulseaudio | emit
  elif command -v SwitchAudioSource &>/dev/null; then
    list_macos | emit
  else
    # stdout, not stderr: a frontend reads items off stdout, so a row sent to
    # stderr is an empty palette that never says why.
    echo '{"id":"error","name":"No audio backend found","icon_xdg":"dialog-error"}'
  fi
}

list_pipewire() {
  wpctl status | awk '
    /Audio/,/Video/ {
      if (/Sinks:/) { in_sinks=1; next }
      if (/Sink endpoints:/ || /Sources:/ || /^[[:space:]]*$/) { in_sinks=0 }
      if (in_sinks && /[0-9]+\./) {
        # wpctl marks the default sink with a `*` in the tree gutter. Read it
        # before the gutter is stripped, and only there - a name may contain one.
        cur = ($0 ~ /^[[:space:]│]*\*/) ? 1 : 0
        gsub(/^[[:space:]│*]+/, "")
        match($0, /^([0-9]+)\. (.+)/, arr)
        if (arr[1] && arr[2]) {
          id = arr[1]
          name = arr[2]
          gsub(/\[vol:.*\]/, "", name)
          gsub(/[[:space:]]+$/, "", name)
          printf "%s\t%s\t%s\n", id, name, cur
        }
      }
    }
  '
}

list_pulseaudio() {
  local default
  default=$(pactl get-default-sink 2>/dev/null)

  pactl list sinks short | while read -r id name _ _ _; do
    desc=$(pactl list sinks | grep -A20 "Sink #$id" | grep "Description:" | head -1 | cut -d: -f2- | xargs)
    printf '%s\t%s\t%s\n' "$id" "$desc" "$([[ "$name" == "$default" ]] && echo 1 || echo 0)"
  done
}

list_macos() {
  # The uid is the stable handle (names collide, ids are renumbered on replug),
  # and `-u` sets by it.
  local current
  current=$(SwitchAudioSource -c -f json | jq -r '.uid')

  SwitchAudioSource -a -t output -f json \
    | jq -r --arg cur "$current" '[.uid, .name, (if .uid == $cur then "1" else "0" end)] | @tsv'
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')
  name=$(echo "$item" | jq -r '.name')

  if command -v wpctl &>/dev/null; then
    wpctl set-default "$id"
  elif command -v pactl &>/dev/null; then
    pactl set-default-sink "$id"
  elif command -v SwitchAudioSource &>/dev/null; then
    SwitchAudioSource -u "$id" >/dev/null
  fi

  jq -cn --arg n "$name" '{hud: ("Output → " + $n), close: true}'
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
