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

pick() { xdg-open "$PAL_ID"; }

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
esac
