#!/usr/bin/env bash

# Config: orgs (array of org names)

cfg() {
  echo "$_PAL_PLUGIN_CONFIG" | jq -r "$1 // empty"
}

list() {
  if ! command -v gh &>/dev/null; then
    echo '{"id":"error","name":"gh cli not found","icon":"dialog-error"}'
    return
  fi

  # Get orgs from config
  orgs=$(cfg '.orgs // []' | jq -r '.[]' 2>/dev/null)

  # List personal repos
  gh repo list --json nameWithOwner,description,isPrivate --limit 100 2>/dev/null | jq -c '.[] | {
    id: .nameWithOwner,
    name: .nameWithOwner,
    desc: (.description // ""),
    icon: (if .isPrivate then "folder-locked" else "folder" end)
  }'

  # List org repos
  for org in $orgs; do
    gh repo list "$org" --json nameWithOwner,description,isPrivate --limit 100 2>/dev/null | jq -c '.[] | {
      id: .nameWithOwner,
      name: .nameWithOwner,
      desc: (.description // ""),
      icon: (if .isPrivate then "folder-locked" else "folder" end)
    }'
  done
}

pick() {
  item=$(cat)
  repo=$(echo "$item" | jq -r '.id')

  if [[ -z "$repo" ]]; then
    return
  fi

  # Open in browser
  gh repo view "$repo" --web
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
