#!/usr/bin/env bash
# The shell around pal-pack that every registry publish needs: fetching the
# live index, picking what changed, signing, mirroring and uploading. Used by
# the Action beside it (action.yml) and by pal's own
# .github/workflows/extensions.yml, so both publish the same way. The formats
# are docs/registry.md's.
set -euo pipefail

usage() { sed -n 's/^  # \(.*\)/\1/p' "$0" >&2; exit 2; }
[ $# -gt 0 ] || usage
cmd=$1; shift
case $cmd in
  # fetch <index url> <out>: the live index and its .minisig beside it,
  # verified against any key in $PUBKEYS (space separated) when that is set.
  # A 404 leaves no <out> (the first publish); any other failure fails, so a
  # flaky site can never make a publish drop every build it did not see.
  fetch)
    url=$1 out=$2
    code=$(curl -sS -o "$out" -w '%{http_code}' "$url")
    case $code in
      200) ;;
      404) rm -f "$out"; echo "no index at $url yet"; exit 0 ;;
      *) echo "::error::GET $url: HTTP $code"; exit 1 ;;
    esac
    curl -fsS -o "$out.minisig" "$url.minisig"
    [ -n "${PUBKEYS:-}" ] || exit 0
    for k in $PUBKEYS; do minisign -Vq -m "$out" -x "$out.minisig" -P "$k" 2> /dev/null && exit 0; done
    echo "::error::$url is not signed by any of the registry's keys"; exit 1 ;;

  # changed <dist> [index]: one "<name> new|listing|same|yanked" line per
  # build in <dist> (pal-pack build's <name>.entry.json). `same` is the
  # index's newest build of that name; `listing` that build with a listing
  # the index does not have yet (a field pal-pack learned to write, a
  # screenshot's caption), which the index takes without a new build;
  # `yanked` a hash the index yanked, which stays pulled even when the tree
  # comes back to it. A missing index makes all of them new.
  changed)
    dist=$1 idx=${2:-/dev/null}
    [ -f "$idx" ] || idx=/dev/null
    for e in "$dist"/*.entry.json; do
      [ -e "$e" ] || continue
      n=$(basename "$e" .entry.json)
      h=$(jq -er '.hash // .build.hash' "$e")
      jq -rs --arg n "$n" --arg h "$h" --argjson l "$(jq -c '.listing // null' "$e")" '
        [.[0].extensions // [] | .[] | select(.name == $n)] as $x
        | [$x[] | .builds[]] as $b
        | if any($b[]; .hash == $h and .yanked) then "yanked"
          elif ($b[0].hash // "") == $h then (if $l == null or $x[0].listing == $l then "same" else "listing" end)
          else "new" end
        | "\($n) \(.)"' "$idx"
    done ;;

  # pick <from> <to> <names file>: copy those builds (the package directory
  # and every <name>.* pal-pack wrote) from one dist to another.
  pick)
    from=$1 to=$2 names=$3
    mkdir -p "$to"
    while read -r n; do cp -R "$from/$n" "$from/$n".* "$to/"; done < "$names" ;;

  # sign <key> <file>...: <file>.minisig for each, with a key made without a
  # password (minisign -G -W): there is no terminal to type one into.
  sign)
    key=$1; shift
    for f; do minisign -S -s "$key" -m "$f" > /dev/null; done ;;

  # verify <file> : <file>.minisig checks against a key in $PUBKEYS, which
  # catches a secret key that does not match the published public key before
  # anything goes out.
  verify)
    for k in ${PUBKEYS:?PUBKEYS is not set}; do minisign -Vq -m "$1" -x "$1.minisig" -P "$k" 2> /dev/null && exit 0; done
    echo "::error::$1 does not verify with the registry's public key: the secret key is not its pair"; exit 1 ;;

  # resign <index> <key>: every build's sig made again over its statement with
  # <key>, in place. A key rotation: an app that moved its pin checks each
  # build against the new key, so no build may stay signed by the old one.
  resign)
    idx=$1 key=$2 tmp=$(mktemp -d)
    jq -r '.extensions[] | .name as $n | .builds[] | [$n, .hash, .seq, .protocol] | @tsv' "$idx" |
      while IFS=$'\t' read -r n h s p; do
        printf 'pal-build-v1\n%s\n%s\n%s\n%s\n' "$n" "$h" "$s" "$p" > "$tmp/statement"
        minisign -S -s "$key" -m "$tmp/statement" > /dev/null
        jq -n --arg k "$n $h $s" --rawfile v "$tmp/statement.minisig" '{($k): $v}'
      done | jq -s 'add // {}' > "$tmp/sigs.json"
    jq --slurpfile s "$tmp/sigs.json" \
      '.extensions[] |= (.name as $n | .builds[] |= (.sig = $s[0]["\($n) \(.hash) \(.seq)"]))' "$idx" > "$tmp/index.json"
    mv "$tmp/index.json" "$idx"; rm -rf "$tmp" ;;

  # rekey <index> <key>: resign, when <index> is not signed by the first key
  # in $PUBKEYS (the current one; the others are old keys it may still be
  # signed with). The first publish after a key swap re-signs everything.
  # Prints "rekeyed" when it did.
  rekey)
    first=${PUBKEYS%% *}
    minisign -Vq -m "$1" -x "$1.minisig" -P "$first" 2> /dev/null || { "$0" resign "$1" "$2"; echo rekeyed; } ;;

  # mirror <site> <base>: every package and manifest <site>/index.json lists
  # under <base> that <site> lacks, fetched from the live <base>. A Pages
  # deploy replaces the whole site, and pal-pack index writes only this
  # run's packages, so the builds an earlier run published come along.
  mirror)
    site=$1 base=${2%/}
    jq -r '.extensions[].builds[] | .url, .manifest' "$site/index.json" | while read -r u; do
      case $u in "$base"/*) p=${u#"$base"/} ;; *) continue ;; esac
      [ -f "$site/$p" ] || { mkdir -p "$(dirname "$site/$p")"; curl -fsS -o "$site/$p" "$u"; }
    done ;;

  # put <url> <file> [content type]: PUT with $PAL_PUBLISH_TOKEN as the
  # bearer, failing on anything but a 2xx (curl -f would let a 3xx through).
  put)
    url=$1 f=$2 type=${3:-}
    [ -n "$type" ] || case $f in *.tar.gz) type=application/gzip ;; *) type=application/json ;; esac
    body=$(mktemp)
    code=$(curl -sS -o "$body" -w '%{http_code}' --retry 3 -X PUT \
      -H "Authorization: Bearer ${PAL_PUBLISH_TOKEN:?PAL_PUBLISH_TOKEN is not set}" \
      -H "Content-Type: $type" --data-binary "@$f" "$url")
    case $code in 2??) echo "PUT $url: $code" ;; *) echo "::error::PUT $url: HTTP $code"; cat "$body"; exit 1 ;; esac ;;

  # summary <old index|-> <new index>: a Markdown table of the extensions
  # whose newest build differs between the two.
  summary)
    old=$1 new=$2
    [ -f "$old" ] || old=/dev/null
    jq -rn --slurpfile o "$old" --slurpfile n "$new" '
      ($o[0].extensions // [] | map({key: .name, value: .builds[0].hash}) | from_entries) as $was
      | [$n[0].extensions[] | select(.builds[0].hash != $was[.name])] as $c
      | if $c == [] then "Nothing changed."
        else "| extension | hash | seq | commit |\n|---|---|---|---|",
          ($c[] | .builds[0] as $b | "| \(.name) | `\($b.hash[0:16])` | \($b.seq) | \(($b.commit // "")[0:10]) |")
        end' ;;

  *) usage ;;
esac
