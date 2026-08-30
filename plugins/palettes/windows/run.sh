#!/usr/bin/env bash

# Every backend produces the same row: the app is the title (it's what you
# scan for), the window title is the subtitle, and the space it lives on is
# the section.
list() {
  if command -v yabai &>/dev/null; then
    list_yabai
  elif command -v hyprctl &>/dev/null; then
    list_hyprland
  elif command -v swaymsg &>/dev/null; then
    list_sway
  elif command -v wmctrl &>/dev/null; then
    list_x11
  else
    echo '{"id":"error","name":"No supported WM found","icon":"dialog-error"}'
  fi
}

list_yabai() {
  yabai -m query --windows | jq -c '.[]
    | select(.title != "" or .app != "")
    | {
        id: (.id | tostring),
        name: .app,
        subtitle: .title,
        class: .app,
        title: .title,
        workspace: .space,
        keywords: [.app, .title],
        section: "Space \(.space)",
        icon_rc: "AppWindow",
        accessories: (
          (if ."has-focus" then [{ tag: { value: "focused", color: "green" } }] else [] end)
          + (if .["is-minimized"] then [{ tag: { value: "minimized", color: "secondary" } }] else [] end)
          + (if .["is-floating"] then [{ tag: { value: "floating", color: "blue" } }] else [] end)
        )
      }'
}

list_hyprland() {
  hyprctl clients -j | jq -c '.[] | {
    id: .address,
    name: .class,
    subtitle: .title,
    class: .class,
    title: .title,
    workspace: .workspace.id,
    keywords: [.class, .title],
    section: "Workspace \(.workspace.id)",
    icon_rc: "AppWindow",
    icon: .class | ascii_downcase
  }'
}

list_sway() {
  swaymsg -t get_tree | jq -c '
    recurse(.nodes[]?, .floating_nodes[]?) |
    select(.type == "con" and .app_id != null) |
    {
      id: .id | tostring,
      name: .app_id,
      subtitle: .name,
      class: .app_id,
      title: .name,
      keywords: [.app_id, .name],
      icon_rc: "AppWindow",
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

  if command -v yabai &>/dev/null; then
    yabai -m window --focus "$id"
    jq -cn --arg t "$(echo "$item" | jq -r '.name')" '{hud: ("Focused " + $t), close: true}'
  elif command -v hyprctl &>/dev/null; then
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
