#!/usr/bin/env bash
# A script command with arguments and a confirmation. Drop it (executable)
# into ~/.config/pal/commands/ and it is a row of the Script Commands
# palette: Enter opens a form for the target, Run asks "Deploy site?", then
# the panel hides and the HUD shows the first line this prints.
#
# @pal.title Deploy site
# @pal.description Push the site to an environment
# @pal.icon 🚀
# @pal.mode hud
# @pal.confirm true
# @pal.keyword deploy ship
# @pal.args target Environment: staging or prod
# @pal.args note Release note (optional)

set -euo pipefail
target="${1:?target}"
note="${2:-}"

# Whatever your deploy is: rsync, a `make deploy`, a webhook...
sleep 1
echo "Deployed to $target${note:+ ($note)} at $(date +%H:%M)"
