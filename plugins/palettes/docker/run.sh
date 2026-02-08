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
  # Get action from config or show menu
  action=$(cfg '.action // empty')

  if [[ -z "$action" ]]; then
    # Show action menu based on state
    if [[ "$PAL_STATE" == "running" ]]; then
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

    action_item=$(echo "$actions" | pal select)
    action=$(echo "$action_item" | jq -r '.id // empty')
  fi

  [[ -z "$action" ]] && exit 0

  # Get terminal for interactive commands
  terminal="${TERMINAL:-kitty}"

  case "$action" in
    start)
      docker start "$PAL_ID"
      notify-send -t 2000 "Docker" "Started $PAL_NAME"
      ;;
    stop)
      docker stop "$PAL_ID"
      notify-send -t 2000 "Docker" "Stopped $PAL_NAME"
      ;;
    restart)
      docker restart "$PAL_ID"
      notify-send -t 2000 "Docker" "Restarted $PAL_NAME"
      ;;
    logs)
      case "$terminal" in
        kitty) kitty -- docker logs -f "$PAL_ID" ;;
        alacritty) alacritty -e docker logs -f "$PAL_ID" ;;
        foot) foot docker logs -f "$PAL_ID" ;;
        *) $terminal -e docker logs -f "$PAL_ID" ;;
      esac
      ;;
    exec)
      # Try common shells
      shell="sh"
      docker exec "$PAL_ID" which bash &>/dev/null && shell="bash"
      case "$terminal" in
        kitty) kitty -- docker exec -it "$PAL_ID" "$shell" ;;
        alacritty) alacritty -e docker exec -it "$PAL_ID" "$shell" ;;
        foot) foot docker exec -it "$PAL_ID" "$shell" ;;
        *) $terminal -e docker exec -it "$PAL_ID" "$shell" ;;
      esac
      ;;
    remove)
      docker rm -f "$PAL_ID"
      notify-send -t 2000 "Docker" "Removed $PAL_NAME"
      ;;
  esac
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
