#!/usr/bin/env bash

warn() { echo "{\"id\":\"warn\",\"icon\":\"󰀪\",\"name\":\"$1\",\"desc\":\"$2\"}"; }

get_token() {
  if [[ -n "$TEAMS_TOKEN" ]]; then
    echo "$TEAMS_TOKEN"
  elif command -v az &>/dev/null; then
    az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv 2>/dev/null
  fi
}

graph() { curl -s -H "Authorization: Bearer $token" "https://graph.microsoft.com/v1.0/$1"; }

list() {
  token=$(get_token)
  if [[ -z "$token" ]]; then
    warn "Not logged in" "Set TEAMS_TOKEN env var, or run: az login"
    exit 0
  fi

  resp=$(graph 'me/chats?$expand=lastMessagePreview,members&$top=30')

  if echo "$resp" | jq -e '.error' &>/dev/null; then
    msg=$(echo "$resp" | jq -r '.error.message')
    warn "Teams API error" "$msg — try: az login"
    exit 0
  fi

  echo "$resp" | jq -c '.value[] |
        select(.lastMessagePreview != null) |
        {
          id: .webUrl,
          icon: "󰊻",
          name: (
            if .topic != null and .topic != "" then .topic
            else ([.members[].displayName] | join(", "))
            end
          ),
          desc: (
            (.lastMessagePreview.from.user.displayName // .lastMessagePreview.from.application.displayName // "?") +
            ": " +
            (.lastMessagePreview.body.content
              | gsub("<[^>]+>"; "")
              | gsub("\\n|\\r"; " ")
              | gsub("  +"; " ")
              | ltrimstr(" ")
              | .[0:100]
            ) +
            " · " +
            (.lastMessagePreview.createdDateTime | split("T")[0])
          )
        }'
}

pick() { xdg-open "$PAL_ID"; }

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
esac
