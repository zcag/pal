#!/usr/bin/env bash
# Copy the files assets.txt lists from the Ninja Adventure pack (CC0,
# https://pixel-boy.itch.io/ninja-adventure-asset-pack) into surface/assets/.
# Sound becomes mp3, which WebKit on macOS and WebKitGTK on Linux both play.
#   extensions/night-parade/scripts/assets.sh <pack dir>   (the unzipped pack, kept outside the repo)
set -euo pipefail
cd "$(dirname "$0")/.."
pack="${1:?the unzipped Ninja Adventure pack}"
rm -rf surface/assets.new && mkdir surface/assets.new
grep -vE '^\s*(#|$)' assets.txt | while read -r dest src; do
  if [[ "$dest" == */ ]]; then
    mkdir -p "surface/assets.new/$dest"
    while IFS= read -r f; do [[ "$f" == *Disabled* || "$f" == *Preview* ]] || cp "$f" "surface/assets.new/$dest"; done < <(compgen -G "$pack/$src")
    continue
  fi
  mkdir -p "surface/assets.new/$(dirname "$dest")"
  case "$dest" in
    *.mp3) ffmpeg -loglevel error -y -i "$pack/$src" -ac 1 -codec:a libmp3lame -q:a 6 "surface/assets.new/$dest" </dev/null ;;
    *) cp "$pack/$src" "surface/assets.new/$dest" ;;
  esac
done
cp "$pack/LICENSE.txt" surface/assets.new/LICENSE-ninja-adventure.txt
rm -rf surface/assets && mv surface/assets.new surface/assets
du -sh surface/assets surface/assets/*
