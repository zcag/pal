#!/usr/bin/env bash
# Build the MediaRemote adapter pal ships on macOS as the system-wide Now
# Playing source (https://github.com/ungive/mediaremote-adapter, BSD-3-Clause,
# NOTICES.md): since macOS 15.4 `mediaremoted` answers only entitled
# clients, so `nowplaying-cli` gets null for everything, while /usr/bin/perl
# is entitled and this adapter is a small framework perl dlopens. Pinned by
# commit; cloned, built with cmake (needs cmake and the Xcode CLT; on
# hornet cmake is Homebrew's) and copied into app/src-tauri/mediaremote/:
#
#   mediaremote/mediaremote-adapter.pl          the script core runs
#   mediaremote/MediaRemoteAdapter.framework    what it loads (universal)
#   mediaremote/LICENSE, mediaremote/COMMIT
#
# gitignored like binaries/; tauri.macos.conf.json ships the directory in
# Contents/Resources. build.rs runs this when the script is missing;
# idempotent: the pinned commit already built is kept. macOS only: a no-op
# elsewhere, so a Linux build.rs can call it too.
set -euo pipefail

MRA_COMMIT=73f14ab1568371e6e3c44063f21c34c5e2712c4d
MRA_REPO=https://github.com/ungive/mediaremote-adapter.git
out=$(cd "$(dirname "$0")/../src-tauri" && pwd)/mediaremote

if [ "$(uname -s)" != Darwin ]; then
  echo "fetch-mediaremote: macOS only, nothing to do"
  exit 0
fi
if [ -f "$out/mediaremote-adapter.pl" ] && [ "$(cat "$out/COMMIT" 2>/dev/null)" = "$MRA_COMMIT" ]; then
  echo "fetch-mediaremote: $out is at $MRA_COMMIT"
  exit 0
fi
command -v cmake >/dev/null || { echo "fetch-mediaremote: cmake is needed (brew install cmake)" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" fetch -q --depth 1 "$MRA_REPO" "$MRA_COMMIT"
git -C "$tmp" checkout -q FETCH_HEAD
# Universal (CMAKE_OSX_ARCHITECTURES in its CMakeLists), ad-hoc signed by
# its own post-build step; the test client target is not needed.
cmake -S "$tmp" -B "$tmp/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$tmp/build" --target MediaRemoteAdapter >/dev/null

rm -rf "$out"
mkdir -p "$out"
# -R keeps the framework's Versions/Current symlinks.
cp -R "$tmp/build/MediaRemoteAdapter.framework" "$out/"
cp "$tmp/bin/mediaremote-adapter.pl" "$tmp/LICENSE" "$out/"
echo "$MRA_COMMIT" > "$out/COMMIT"
echo "fetch-mediaremote: $out ($MRA_COMMIT)"
