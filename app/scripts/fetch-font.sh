#!/usr/bin/env bash
# Fetch the Nerd Fonts symbols TTF the menu bar renderer rasterises glyphs
# from (`bar/glyph.rs`, `ab_glyph` reads TTF, not the woff2 the webview
# uses), into app/src-tauri/fonts/. Same release and file as
# app/src/assets/fonts/SymbolsNerdFontMono-Regular.woff2 (its LICENSES
# file covers both); pinned by version and the archive's SHA256. Idempotent:
# an existing file of the right size is kept. build.rs runs this when the
# file is missing, so a fresh clone needs no README step.
set -euo pipefail

NF_VERSION=3.5.1
NF_SHA256=01172f37db8543edb102e5cb5c64101c9f4686630804d49b419aa07b23a69996
FILE=SymbolsNerdFontMono-Regular.ttf
url="https://github.com/ryanoasis/nerd-fonts/releases/download/v$NF_VERSION/NerdFontsSymbolsOnly.tar.xz"
out=$(cd "$(dirname "$0")/../src-tauri" && pwd)/fonts

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

if [ -s "$out/$FILE" ]; then
  echo "fetch-font: $out/$FILE present"
  exit 0
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/nf.tar.xz"
got=$(sha256 "$tmp/nf.tar.xz")
[ "$got" = "$NF_SHA256" ] || { echo "fetch-font: checksum mismatch: $got != $NF_SHA256" >&2; exit 1; }
tar -xJf "$tmp/nf.tar.xz" -C "$tmp" "$FILE"
mkdir -p "$out"
mv "$tmp/$FILE" "$out/$FILE"
echo "fetch-font: $out/$FILE (Nerd Fonts v$NF_VERSION)"
