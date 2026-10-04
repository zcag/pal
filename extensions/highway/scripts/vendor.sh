#!/usr/bin/env bash
# Rebuild surface/vendor/three.js: three.js and the add-ons the page uses, one
# minified module (the page is served file by file, no bundler, and a bare
# `import "three"` would not resolve). Keep surface/vendor/three.d.ts in step.
#   extensions/highway/scripts/vendor.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bun install --frozen-lockfile
bun build scripts/vendor-entry.js --minify --format esm --outfile surface/vendor/three.js
