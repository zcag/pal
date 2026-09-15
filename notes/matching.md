# Matching in Rust (hornet, 2026-09-16)

Question: move the item corpus into the Rust core, match and rank there
(nucleo), send only the top N to the webview? What does a keystroke cost then?

Code: `matchbench/` (workspace member), `cargo run --release -p matchbench`.
Corpus `app/fixtures/all.jsonl`, 14719 rows (12.5k iconnerd, 1.9k emoji, 97
apps, the rest small). Box: hornet, M5 Max, 18 threads, release build.
Medians of 40 runs after 5 warmup; p95 in parentheses where it matters.
Linux (marko) not measured; the JS side is what was slow there, see below.

## Engines

- **nucleo par**: the `nucleo` crate as Helix uses it. `Injector::push` every
  item, `pattern.reparse` per keystroke, `tick(10)` until `running` is false,
  read the snapshot. One column holding the same joined haystack the webview
  builds today (`name subtitle keywords...`). nucleo's columns are AND-ed
  query parts (`%col` syntax in Helix), not weighted fields, so name weighting
  is not expressible there; `prefer_prefix` is the only lever.
- **weighted**: `nucleo-matcher` directly, single thread. Name, each keyword
  and the subtitle are separate `Utf32String`s; each query word takes its best
  field (name 100%, keyword 80%, subtitle 50%), score is the sum, every word
  must land somewhere. Top 200 by `select_nth_unstable` then sort.
- **substring**: lowercase `str::find` per word, scored by where it landed.
- **fzf-for-js**: the `fzf` npm package over the same haystack, `limit: 200`,
  in Node 26 (V8), not the webview. Positions come with every result there.

## Per keystroke, top 200 with scores

| query | nucleo par 18 thr | nucleo par 4 thr | nucleo par 1 thr | weighted (1 thr) | substring | fzf-for-js (Node) |
|---|---:|---:|---:|---:|---:|---:|
| `c` | 514 us | 289 us | 650 us | 423 us | 200 us | 4.11 ms |
| `ch` | 455 us | 312 us | 510 us | 396 us | 331 us | 4.52 ms |
| `chr` | 451 us | 318 us | 477 us | 371 us | 365 us | 4.25 ms |
| `chro` | 440 us | 314 us | 435 us | 338 us | 371 us | 3.71 ms |
| `chrom` | 441 us | 280 us | 384 us | 346 us | 348 us | 3.13 ms |
| `chrome` | 489 us | 316 us | 394 us | 310 us | 374 us | 2.59 ms |
| `ha` | 544 us | 394 us | 591 us | 432 us | 350 us | 5.63 ms |
| `grafana` (0 real hits) | 571 us | 328 us | 420 us | 231 us | 398 us | 2.60 ms |
| `😀` | 408 us | 199 us | 118 us | 129 us | 316 us | 0.47 ms |
| `smile` | 459 us | 340 us | 446 us | 312 us | 348 us | 3.61 ms |
| `xqzv` | 382 us | 220 us | 201 us | 305 us | 296 us | 1.03 ms |
| `smiling face eyes` | 454 us | 312 us | 434 us | 251 us | 393 us | 1.49 ms |

p95 stays under 0.75 ms for every Rust engine and query (one 2.1 ms outlier
seen once on the 4-thread `ha`, scheduler noise). Node p95 is within 0.2 ms
of its median except `smile` (7.9 ms, GC).

Match counts differ by design: joined haystack (par, fzf) matches `chrome`
222 times and `slack` 212 (letters scattered across emoji keyword lists);
per-field matches 16 and 9. `grafana` is not in the corpus at all: the joined
haystack still "finds" 201 fuzzy hits, the field engine 0.

Incremental (`append = true`, nucleo par 18 thr, typing `chrome`): 498, 381,
299, 259, 238, 283 us. Rescoring only the previous matches saves about half
at the tail; at this corpus size it does not matter.

## The rest of a keystroke

| step, 200 rows | time | note |
|---|---:|---:|
| highlight positions (`Pattern::indices` on the name) | 1 to 110 us | 80 to 110 us for 6-letter fuzzy hits, 2 to 25 us short queries |
| serde_json of 200 hits (id, name, subtitle, icon, palette, score, positions) | 14 to 17 us | 18 to 22 KB |
| `JSON.parse` of that payload in V8 | 41 us | measured in Node |
| Tauri invoke round trip | not measured | needs the app; the full 1.7 MB feed reached the webview in 25 ms (hornet) / 57 ms (marko) per `linux.md`, a 20 KB reply is 1% of that plus the fixed invoke cost |

Rust side total per keystroke, worst query: 0.7 ms (par 18 thr, `grafana`),
0.45 ms (weighted, `ha`).

## Injector (streaming corpus into nucleo par)

| step | push (builds `Utf32String` per item) | worker settles |
|---|---:|---:|
| load 14719 items, empty pattern | 1.10 ms | 34 us |
| append 2000 while `chrome` is active | 436 us (4 thr: 407) | 210 us (4 thr: 89) |

Rayon pool: 180 us to build for 18 threads, 41 us for 4. The weighted engine's
index (per-field `Utf32String`s) is the same order, built once. JSONL parse of
the corpus itself: 4 ms.

## Ranking, top 10

Scores are nucleo's (16 per matched char plus bonuses; a word-start match
after whitespace scores the same as a match at the start of the string, so
exact vs prefix vs word-start is decided by the tie-break, not the score).

**nucleo par, joined haystack** (tie-break: total haystack length, then
corpus order)

- `chrome`: chrome, chrome, chromecast, chrome_close, chrome_restore,
  chrome_maximize, chrome_minimize, **Google Chrome (8th)**, **cast (9th, via
  keyword chromecast, same score 166 as the exact name hit)**, google_chrome.
- `ha`: hand, hat, hail, hamsa, hands, hash, hammer, hammer, hanger, haml.
  The bookmark named exactly `ha` is not in the top 10: its haystack
  `ha assistant home` is longer than `hand nf-fa`.
- `slack`: slack x3, slackware, slackware_inverse, **Slack app 6th**, then
  japanese_free_of_charge_button, snowflake_check, club_suit, heart_suit
  (junk: s-l-a-c-k across `poker,cards,magic,suits,black,card`).
- `term`: ten `terminal*` nerd icons. **Terminal.app not in the top 10**: its
  haystack `Terminal macOS com.apple.Terminal` loses the length tie-break.
- `prefer_prefix = true` lifts name hits by a few points (chrome 174, Google
  Chrome 169, cast 166) but does not fix `ha` or `term`: it is distance from
  the start of the joined string, not a field weight.

So the joined haystack gets exact-first and prefix-over-infix right, but a
keyword hit ties a name hit, items with keywords or subtitles lose ties for
being longer, and fuzzy noise from keyword lists fills the tail. Same shape as
fzf-for-js today, whose `ha` top 10 starts with `Claude Code URL Handler`.

**weighted fields** (tie-break: name length, then corpus order)

- `chrome`: chrome, chrome, chromecast, chrome_close, **Google Chrome (5th)**,
  chrome_restore, chrome_maximize, chrome_minimize, google_chrome x2.
  `cast` (keyword) scores 132 and sits below every name hit but above weak
  fuzzy name hits.
- `ha`: **ha (bookmark) first**, hat, harp, hand, hail, hash, haml, haxe, hail,
  hamsa.
- `slack`: **Slack app first**, slack x3, slackware, slackware_inverse,
  snowflake_check, shuffle_tracks_button, mbp (9 matches total).
- `term`: **Terminal.app first**, terminal x4, terminal_cmd, terminal_bash,
  terminal_tmux, terminal_linux, terminal_badge.
- `cast tv` (cross-field): `cast` first (name `cast` + keyword `tv`), then
  cast_variant, cast_audio_variant.

Exact first, prefix over infix, keywords help without dominating: this is the
ranking a user expects. Substring gives the same heads and only loses the
fuzzy tail (36 matches for `smile` against 118).

**Frecency hook**: in `Weighted::query`, between scoring and `top_n`. Every
match carries `(idx, score)`; a per-id frecency lookup there (one hash map
read per match, 7.6k for `c`; not measured, but that is a fraction of the
scan that produced them) can add to or multiply the score before the top-200
select, so a frequently launched item that matched weakly still climbs. Applied after the select it could only reorder the 200.
For the empty query the same table orders the corpus on its own.

## Recommendation

Move the corpus into the Rust core and match there; keep only the top 200
in the webview. The whole Rust side of a keystroke, matching, highlighting
and serialising, is under 0.7 ms on hornet for every query tried, against
2.6 to 5.6 ms for fzf-for-js in V8 on the same corpus (the webview's JSC on
marko's Ryzen is presumably slower, which would be part of the 24 to 76 ms
keystroke-to-paint there: a guess, the JS/render split was never measured,
and the render half stays either way). Use
`nucleo-matcher` directly on one thread with per-field scoring (the
`weighted` engine): it gives the right ranking, it is synchronous and simple
(no pool, no tick/snapshot dance), and it is as fast as the parallel worker at
this size. The `nucleo` worker buys nothing here: 18 threads are slower than 4
and its column model cannot weight name over keywords; it becomes worth it
past roughly 100k items or if matching has to leave the IPC thread. The
20 KB reply is 16 us to serialise and 41 us to parse; the one number still
missing is the Tauri invoke round trip, to take in the app with a mark.
