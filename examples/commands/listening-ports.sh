#!/usr/bin/env bash
# A list-mode script command: Enter opens a level whose rows are the JSON
# lines this prints. A row with `copy` copies it, one with `url` opens it;
# any other row runs the script again with PAL_PICK set to the row's id
# (here: nothing to do, so the id is echoed to the HUD).
#
# @pal.title Listening ports
# @pal.description Every TCP port something is listening on
# @pal.icon cyan
# @pal.mode list
# @pal.keyword ports lsof

if [ -n "${PAL_PICK:-}" ]; then
  echo "Port $PAL_PICK"
  exit 0
fi

lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 {
  split($9, a, ":"); port = a[length(a)]
  if (seen[port]++) next
  printf "{\"id\":\"%s\",\"name\":\":%s\",\"subtitle\":\"%s (pid %s)\",\"copy\":\"%s\",\"accessories\":[{\"text\":\"%s\"}]}\n", port, port, $1, $2, port, $5
}'
