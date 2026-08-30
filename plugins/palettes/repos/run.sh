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
  gh repo list --json nameWithOwner,description,isPrivate,primaryLanguage,pushedAt,url --limit 100 2>/dev/null | jq -c '.[] | {
    id: .nameWithOwner,
    url: .url,
    name: (.nameWithOwner | split("/")[1]),
    subtitle: (.description // ""),
    keywords: [.nameWithOwner, (.primaryLanguage.name // "")],
    section: (.nameWithOwner | split("/")[0]),
    icon_rc: (if .isPrivate then "Lock" else "Code" end),
    accessories: (
      (if .isPrivate then [{ tag: { value: "private", color: "orange" } }] else [] end)
      + (if .primaryLanguage then [{ text: { value: .primaryLanguage.name, color: "secondary" } }] else [] end)
      + [{ text: { value: (.pushedAt | split("T")[0]), color: "secondary" } }]
    )
  }'

  # List org repos
  for org in $orgs; do
    gh repo list "$org" --json nameWithOwner,description,isPrivate,primaryLanguage,pushedAt,url --limit 100 2>/dev/null | jq -c '.[] | {
      id: .nameWithOwner,
      url: .url,
      name: (.nameWithOwner | split("/")[1]),
      subtitle: (.description // ""),
      keywords: [.nameWithOwner, (.primaryLanguage.name // "")],
      section: (.nameWithOwner | split("/")[0]),
      icon_rc: (if .isPrivate then "Lock" else "Code" end),
      accessories: (
        (if .isPrivate then [{ tag: { value: "private", color: "orange" } }] else [] end)
        + (if .primaryLanguage then [{ text: { value: .primaryLanguage.name, color: "secondary" } }] else [] end)
        + [{ text: { value: (.pushedAt | split("T")[0]), color: "secondary" } }]
      )
    }'
  done
}

pick() {
  item=$(cat)
  repo=$(echo "$item" | jq -r '.id')

  if [[ -z "$repo" ]]; then
    return
  fi

  # A clone you already have is nearly always what you wanted.
  local local_clone="$HOME/proj/${repo##*/}"
  if [[ -d "$local_clone" ]]; then
    jq -cn --arg p "$local_clone" '{open: $p, hud: ("Opened " + $p), close: true}'
  else
    gh repo view "$repo" --web
    jq -cn --arg r "$repo" '{hud: ("Opened " + $r), close: true}'
  fi
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
