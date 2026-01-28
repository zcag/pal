#!/usr/bin/env bash

# Docker container management palette
# Actions: start, stop, restart, logs, exec, remove

cfg() {
  echo "$_PAL_PLUGIN_CONFIG" | jq -r "$1"
}

list() {
  # Show all containers (running and stopped)
  docker ps -a --format '{{json .}}' | jq -c '{
    id: .ID,
    name: .Names,
    desc: (.Image + " - " + .Status),
    icon: (if .State == "running" then "media-playback-start" else "media-playback-stop" end),
    state: .State,
    image: .Image
  }'
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')
  name=$(echo "$item" | jq -r '.name')
  state=$(echo "$item" | jq -r '.state')

  # Get action from config or show menu
  action=$(cfg '.action // empty')

  if [[ -z "$action" ]]; then
    # Show action menu based on state
    if [[ "$state" == "running" ]]; then
      actions='{"id":"logs","name":"View logs","icon":"text-x-generic"}
{"id":"exec","name":"Exec shell","icon":"utilities-terminal"}
{"id":"stop","name":"Stop","icon":"media-playback-stop"}
{"id":"restart","name":"Restart","icon":"view-refresh"}
{"id":"remove","name":"Remove (force)","icon":"edit-delete"}'
    else
      actions='{"id":"start","name":"Start","icon":"media-playback-start"}
{"id":"logs","name":"View logs","icon":"text-x-generic"}
{"id":"remove","name":"Remove","icon":"edit-delete"}'
    fi

    # Use pal to pick action if available, otherwise default
    if [[ -n "$_PAL_CONFIG" ]] && [[ -n "$_PAL_FRONTEND" ]]; then
      action_item=$(echo "$actions" | pal -c "$_PAL_CONFIG" run "$_PAL_FRONTEND" stdin)
      action=$(echo "$action_item" | jq -r '.id // empty')
    else
      # Default action based on state
      if [[ "$state" == "running" ]]; then
        action="logs"
      else
        action="start"
      fi
    fi
  fi

  [[ -z "$action" ]] && exit 0

  # Get terminal for interactive commands
  terminal="${TERMINAL:-kitty}"

  case "$action" in
    start)
      docker start "$id"
      notify-send -t 2000 "Docker" "Started $name"
      ;;
    stop)
      docker stop "$id"
      notify-send -t 2000 "Docker" "Stopped $name"
      ;;
    restart)
      docker restart "$id"
      notify-send -t 2000 "Docker" "Restarted $name"
      ;;
    logs)
      case "$terminal" in
        kitty) kitty -- docker logs -f "$id" ;;
        alacritty) alacritty -e docker logs -f "$id" ;;
        foot) foot docker logs -f "$id" ;;
        *) $terminal -e docker logs -f "$id" ;;
      esac
      ;;
    exec)
      # Try common shells
      shell="sh"
      docker exec "$id" which bash &>/dev/null && shell="bash"
      case "$terminal" in
        kitty) kitty -- docker exec -it "$id" "$shell" ;;
        alacritty) alacritty -e docker exec -it "$id" "$shell" ;;
        foot) foot docker exec -it "$id" "$shell" ;;
        *) $terminal -e docker exec -it "$id" "$shell" ;;
      esac
      ;;
    remove)
      docker rm -f "$id"
      notify-send -t 2000 "Docker" "Removed $name"
      ;;
  esac
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
