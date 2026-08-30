#!/usr/bin/env bash

list() {
  gh search prs --review-requested=@me --state=open \
    --json number,title,repository,author,url,updatedAt,isDraft \
    | jq -c '.[] | {
      id: .url,
      icon: "",
      name: (.repository.name + " #" + (.number|tostring)),
      desc: ((.title | ltrimstr(" ") | rtrimstr(" "))
        + " · " + .author.login
        + " · " + (.updatedAt | split("T")[0]))
    }'
}

# `open` handles xdg-open and macOS `open`, and returns the envelope.
pick() { printf '%s' "$PAL_ID" | pal action open; }

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
esac
