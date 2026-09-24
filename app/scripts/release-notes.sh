#!/usr/bin/env bash
# A release's notes, as GitHub shows them: the version's section of
# docs/changelog.md (written for users; make release refuses a version
# without one), then every commit since the previous v* tag reachable from
# this one, folded, and the links to the site's changelog and downloads.
#
#   app/scripts/release-notes.sh v0.4.4
set -euo pipefail

tag=$1
prev=$(git describe --tags --abbrev=0 --match 'v*' "$tag^" 2>/dev/null || true)
awk -v v="${tag#v}" '/^## /{on = ($2 == v); next} on' docs/changelog.md
echo
echo "<details><summary>Commits</summary>"
echo
git log --no-merges --format='- %s' "${prev:+$prev..}$tag"
echo
echo "</details>"
echo
echo "Every release: https://pal.cagdas.io/changelog${prev:+?from=${prev#v}}. Download: https://pal.cagdas.io/#download"
