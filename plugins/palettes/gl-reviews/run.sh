#!/usr/bin/env bash

list() {
  glab mr list \
    --reviewer=@me \
    --output json \
  | jq -c '.[] | {
      id: .web_url,
      icon: "",
      name: (.references.full),
      desc: (
        (.title | gsub("^ +| +$"; "")) +
        " · " + .author.username +
        " · " + (.updated_at | split("T")[0])
      )
    }'
}


pick() { xdg-open "$PAL_ID"; }

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
esac
