#!/usr/bin/env bash

list() {
  if command -v hyprctl &>/dev/null; then
    list_hyprland
  elif command -v swaymsg &>/dev/null; then
    list_sway
  elif command -v wmctrl &>/dev/null; then
    list_x11
  else
    echo '{"id":"error","name":"No supported WM found","icon":"dialog-error"}'
  fi
}

list_hyprland() {
  hyprctl clients -j | jq -c '.[] | {
    id: .address,
    name: "\(.class) - \(.title)",
    class: .class,
    title: .title,
    workspace: .workspace.id,
    icon: .class | ascii_downcase
  }'
}

list_sway() {
  swaymsg -t get_tree | jq -c '
    recurse(.nodes[]?, .floating_nodes[]?) |
    select(.type == "con" and .app_id != null) |
    {
      id: .id | tostring,
      name: "\(.app_id) - \(.name)",
      class: .app_id,
      title: .name,
      icon: .app_id | ascii_downcase
    }
  '
}

list_x11() {
  wmctrl -l | while read -r id _ _ title; do
    class=$(xprop -id "$id" WM_CLASS 2>/dev/null | cut -d'"' -f2)
    echo "{\"id\":\"$id\",\"name\":\"$class - $title\",\"class\":\"$class\",\"title\":\"$title\",\"icon\":\"${class,,}\"}"
  done
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')

  if command -v hyprctl &>/dev/null; then
    hyprctl dispatch focuswindow "address:$id"
  elif command -v swaymsg &>/dev/null; then
    swaymsg "[con_id=$id] focus"
  elif command -v wmctrl &>/dev/null; then
    wmctrl -i -a "$id"
  fi
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
