#!/usr/bin/env bash
# Stage what the extension host needs at runtime into app/src-tauri/resources,
# the tree `bundle.resources` in tauri.conf.json ships (macOS: pal.app/Contents/
# Resources, Linux: usr/lib/pal):
#
#   resources/host/src/*.ts            the host, run by the bun sidecar as-is
#   resources/sdk/{package.json,src/*.ts}  the SDK (`@zcag/pal`): the host
#                                          imports it by relative path and
#                                          links it into every user root
#   resources/extensions/<name>/           each extension in app/bundled.txt,
#                                          a package exactly as the registry
#                                          serves it: index.js (+ chunks),
#                                          pal.json with `protocol` stamped, a
#                                          game's surface/ and the sources it
#                                          imports, and .pal-build.json {hash,
#                                          seq, protocol, commit}, which the
#                                          core compares with our registry
#   resources/extensions/node_modules/@zcag/pal/  a copy of the SDK
#
# Where the packages come from (PAL_BUNDLE):
#
#   registry (the default; what a release bundles): the stable index's newest
#     build of each name that this pal runs (its protocol in PROTOCOL_MIN..
#     PROTOCOL), the index checked against the keys built into the app
#     (core/src/registry.rs PAL_KEYS), the build's statement against them too,
#     and the unpacked tree against the build's hash. Downloads are kept in
#     target/registry-cache. PAL_REGISTRY and PAL_CHANNEL point elsewhere
#     (default https://pal.cagdas.io/registry, stable).
#   local (`make app`): built by pal-pack (sdk/bin/pal-pack.ts) from the
#     extension repos' checkouts (../pal-extensions, ../pal-games, or
#     PAL_EXTENSION_REPOS; app/scripts/extension-repos.mjs), offline, the
#     working tree as it is.
#
# A package has `@zcag/pal` external, so an SDK change does not change every
# package, and the build the registry serves is the one bundled, with one
# hash. The import resolves at run time through the copy of the SDK in the
# bundled root's node_modules: real files, since a signed .app holds no
# symlinks (the host links the SDK into user roots instead, and leaves this
# root alone).
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
out="$root/app/src-tauri/resources"
mode=${PAL_BUNDLE:-registry}
bun=${BUN:-$(command -v bun || true)}
if [ -z "$bun" ]; then
  triple=$(rustc -vV | sed -n 's/^host: //p')
  bun="$root/app/src-tauri/binaries/pal-bun-$triple"
  [ -x "$bun" ] || "$root/app/scripts/fetch-bun.sh" "$triple"
fi
pack() { "$bun" "$root/sdk/bin/pal-pack.ts" "$@"; }
die() { echo "build-extensions: $*" >&2; exit 1; }

# The list, comments and blank lines dropped.
names=$(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$root/app/bundled.txt" | grep -v '^$')

# Staged in a temp dir and synced by checksum, so a file that did not change
# keeps its mtime: tauri-build watches the tree and would otherwise re-link
# the app on every build.
tmp=$(mktemp -d) stage=$tmp/stage
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$stage/host/src" "$stage/sdk/src" "$stage/extensions/node_modules/@zcag/pal/src"
cp "$root"/host/src/*.ts "$stage/host/src/"
for d in "$stage/sdk" "$stage/extensions/node_modules/@zcag/pal"; do
  cp "$root"/sdk/package.json "$d/"
  cp "$root"/sdk/src/*.ts "$d/src/"
done

case $mode in
  local)
    # A name the checkouts lack fails here, so the list cannot drift from them unnoticed.
    list=$("$bun" "$root/app/scripts/extension-repos.mjs" list)
    dirs=()
    for name in $names; do
      dir=$(awk -F'\t' -v n="$name" '$1 == n { print $2 }' <<<"$list")
      [ -f "$dir/index.ts" ] || die "app/bundled.txt lists $name, which no extension repo has (checkouts: $("$bun" "$root/app/scripts/extension-repos.mjs" | tr '\n' ' '))"
      dirs+=("$dir")
    done
    # Staged at extensions/<name>, as the registry's build is (extensions.yml), so an unchanged extension has stable's hash.
    pack build --dir-only --prefix extensions --out "$stage/extensions" "${dirs[@]}" >/dev/null
    ;;
  registry)
    base=${PAL_REGISTRY:-https://pal.cagdas.io/registry} channel=${PAL_CHANNEL:-stable}
    cache=${PAL_BUNDLE_CACHE:-$root/target/registry-cache}
    for t in curl jq minisign tar; do command -v "$t" >/dev/null || die "the registry mode needs $t (brew install $t; or PAL_BUNDLE=local)"; done
    keys=$(sed -n 's/^pub const PAL_KEYS.*= &\[\(.*\)\];/\1/p' "$root/core/src/registry.rs" | grep -o '"[^"]*"' | tr -d '"')
    proto=$(sed -n 's/^pub const PROTOCOL: u32 = \([0-9]*\);/\1/p' "$root/core/src/registry.rs")
    min=$(sed -n 's/^pub const PROTOCOL_MIN: u32 = \([0-9]*\);/\1/p' "$root/core/src/registry.rs")
    [ -n "$keys" ] && [ -n "$proto" ] && [ -n "$min" ] || die "no PAL_KEYS, PROTOCOL or PROTOCOL_MIN in core/src/registry.rs"
    # <file> <sig>: signed by one of the app's keys.
    signed() { for k in $keys; do minisign -Vq -m "$1" -x "$2" -P "$k" 2>/dev/null && return 0; done; return 1; }
    idx="$tmp/index.json"
    curl -fsS -o "$idx" "$base/$channel/index.json" && curl -fsS -o "$idx.minisig" "$base/$channel/index.json.minisig" || die "$base/$channel/index.json: not fetched"
    signed "$idx" "$idx.minisig" || die "$base/$channel/index.json is not signed by a key in core/src/registry.rs PAL_KEYS"
    for name in $names; do
      b=$(jq -c --arg n "$name" --argjson lo "$min" --argjson hi "$proto" \
        '[.extensions[] | select(.name == $n) | .builds[] | select((.yanked | not) and .protocol >= $lo and .protocol <= $hi)] | sort_by(-.seq) | .[0] // empty' "$idx")
      [ -n "$b" ] || die "$name: $channel has no build this pal runs (protocol $min to $proto)"
      hash=$(jq -r .hash <<<"$b") seq=$(jq -r .seq <<<"$b") protocol=$(jq -r .protocol <<<"$b")
      printf 'pal-build-v1\n%s\n%s\n%s\n%s\n' "$name" "$hash" "$seq" "$protocol" > "$tmp/statement"
      jq -j .sig <<<"$b" > "$tmp/statement.minisig"
      signed "$tmp/statement" "$tmp/statement.minisig" || die "$name@$hash: the build's signature does not verify"
      tgz="$cache/$name/$hash.tar.gz"
      if [ ! -f "$tgz" ]; then
        mkdir -p "$cache/$name"
        curl -fsS -o "$tgz.part" "$(jq -r .url <<<"$b")" || die "$name@$hash: not downloaded"
        mv "$tgz.part" "$tgz"
      fi
      rm -rf "$tmp/unpack" && mkdir "$tmp/unpack"
      tar -xzf "$tgz" -C "$tmp/unpack"
      [ "$(ls -A "$tmp/unpack")" = "$name" ] || die "$name@$hash: the tarball is not one $name/ directory"
      got=$(pack tree-hash "$tmp/unpack/$name")
      [ "$got" = "$hash" ] || { rm -f "$tgz"; die "$name: the package hashes to $got, the index says $hash"; }
      mv "$tmp/unpack/$name" "$stage/extensions/$name"
      jq -n --arg h "$hash" --argjson s "$seq" --argjson p "$protocol" --arg c "$(jq -r '.commit // ""' <<<"$b")" \
        '{hash: $h, seq: $s, protocol: $p, commit: $c}' > "$stage/extensions/$name/.pal-build.json"
    done
    ;;
  *) die "PAL_BUNDLE is registry or local, not $mode" ;;
esac

mkdir -p "$out"
rsync -rc --delete "$stage/" "$out/"
echo "build-extensions: $(echo $names | wc -w | tr -d ' ') extensions ($mode) -> $out"
