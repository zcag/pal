// The pure parts of the Spotify extension: PKCE (the RFC 7636 vector),
// LRC parsing, the line for a position at the boundaries, the lyrics
// window the view draws, the colour sampler, and the view tree's shape.
import { describe, expect, test } from "bun:test";
// jpeg-js is the extension's own dependency (extensions/spotify/package.json), reached by path from here.
import { encode } from "../../../extensions/spotify/node_modules/jpeg-js/index.js";
import { checkView } from "../../../sdk/src/view.ts";
import { authorizeUrl, challenge, redirectUri, verifier } from "../../../extensions/spotify/auth.ts";
import { positionOf, toPlayer, toTrack } from "../../../extensions/spotify/api.ts";
import { dominant, nearestTag, tintOf, withAlpha } from "../../../extensions/spotify/color.ts";
import { currentLine, lineAt, parseLrc } from "../../../extensions/spotify/lyrics.ts";
import { actions, clock, render, window as lyricWindow, type NowState } from "../../../extensions/spotify/view.ts";

describe("pkce", () => {
  test("S256 of the RFC 7636 appendix B verifier is its challenge", () => {
    expect(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  test("a verifier is 43..128 unreserved characters and fresh every time", () => {
    const a = verifier(), b = verifier();
    expect(a).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(a).not.toBe(b);
  });
  test("the authorize url carries the client, the loopback redirect, S256 and the scopes", () => {
    const u = new URL(authorizeUrl({ clientId: "abc", redirectUri: redirectUri(27182), challenge: "ch", state: "st", scopes: ["a", "b"] }));
    expect(u.pathname).toBe("/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: "abc", response_type: "code", redirect_uri: "http://127.0.0.1:27182/callback", state: "st", scope: "a b", code_challenge_method: "S256", code_challenge: "ch" });
  });
});

const LRC = `[ar:Radiohead]
[ti:Weird Fishes]

[00:58.19] In the deepest ocean
[01:04.070] The bottom of the sea
[01:09:72] Your eyes
[01:16.14]
[01:23.23][01:29.41] Why should I stay?
`;

describe("lrc", () => {
  test("timestamps in the three spellings, id tags and blank lines dropped, a repeated tag twice, a pause line kept empty, sorted by time", () => {
    expect(parseLrc(LRC)).toEqual([
      { at: 58.19, text: "In the deepest ocean" },
      { at: 64.07, text: "The bottom of the sea" },
      { at: 69.72, text: "Your eyes" },
      { at: 76.14, text: "" },
      { at: 83.23, text: "Why should I stay?" },
      { at: 89.41, text: "Why should I stay?" },
    ]);
    expect(parseLrc("no tags here\n")).toEqual([]);
  });

  test("lineAt at the boundaries: before the first is -1, a line starts on its own second, the last holds to the end", () => {
    const lines = [{ at: 10, text: "a" }, { at: 20, text: "b" }, { at: 30, text: "c" }];
    expect(lineAt(lines, 0)).toBe(-1);
    expect(lineAt(lines, 9.999)).toBe(-1);
    expect(lineAt(lines, 10)).toBe(0);
    expect(lineAt(lines, 19.999)).toBe(0);
    expect(lineAt(lines, 20)).toBe(1);
    expect(lineAt(lines, 30)).toBe(2);
    expect(lineAt(lines, 1000)).toBe(2);
    expect(lineAt([], 5)).toBe(-1);
    expect(currentLine(lines, 25)).toBe("b");
    expect(currentLine(lines, 5)).toBeUndefined();
    expect(currentLine([{ at: 1, text: "" }], 2)).toBeUndefined();
  });

  test("the window keeps the current line in place: padded before the first line, a note for the intro, padded past the last", () => {
    const lines = parseLrc(LRC);
    const intro = lyricWindow(lines, 30, 2);
    expect(intro.map((l) => [l.key, l.role, l.text])).toEqual([["pre3", "before", ""], ["pre2", "before", ""], ["intro", "current", "♪"], ["l0", "after", "In the deepest ocean"], ["l1", "after", "The bottom of the sea"]]);
    const mid = lyricWindow(lines, 70, 2);
    expect(mid.map((l) => [l.key, l.role])).toEqual([["l0", "before"], ["l1", "before"], ["l2", "current"], ["l3", "after"], ["l4", "after"]]);
    expect(mid[2].text).toBe("Your eyes");
    expect(mid[3].text).toBe("♪");
    const end = lyricWindow(lines, 500, 2);
    expect(end.map((l) => l.key)).toEqual(["l3", "l4", "l5", "post6", "post7"]);
  });
});

describe("colour", () => {
  test("the dominant colour of a mostly orange picture is orange, mapped to amber; a grey picture is grey", () => {
    const px = new Uint8Array(100 * 4);
    for (let i = 0; i < 100; i++) { const orange = i < 70; px.set(orange ? [230, 120, 20, 255] : [30, 30, 30, 255], i * 4); }
    const c = dominant(px, 4)!;
    expect(Math.round(c.r)).toBe(230);
    expect(nearestTag(c)).toBe("amber");
    const grey = new Uint8Array(16 * 4).fill(128);
    expect(nearestTag(dominant(grey, 4)!)).toBe("grey");
    expect(dominant(new Uint8Array(0), 4)).toBeUndefined();
    expect(withAlpha("#e67814", 0.5)).toBe("#e6781480");
  });
  test("a JPEG is decoded and sampled; bytes that are no JPEG give nothing", () => {
    const w = 16, h = 16, data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([40, 80, 200, 255], i * 4);
    const jpg = encode({ width: w, height: h, data }, 90).data;
    const t = tintOf(new Uint8Array(jpg))!;
    expect(t.tag).toBe("blue");
    expect(t.chroma).toBeGreaterThan(0.5);
    expect(tintOf(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

const track = toTrack({ id: "t1", uri: "spotify:track:t1", name: "Weird Fishes", type: "track", duration_ms: 318_000, artists: [{ name: "Radiohead" }], album: { name: "In Rainbows", images: [{ url: "https://i/640", height: 640, width: 640 }, { url: "https://i/300", height: 300, width: 300 }, { url: "https://i/64", height: 64, width: 64 }] }, external_urls: { spotify: "https://open.spotify.com/track/t1" } })!;
const lines = parseLrc(LRC);
const base: NowState = { layout: "wide", track, playing: true, position: 70, shuffle: true, repeat: "context", liked: true, device: { name: "hornet", volume: 40 }, lyrics: { synced: lines }, cover: "data:image/jpeg;base64,AAAA", tint: { hex: "#e67814", tag: "amber", chroma: 0.9 } };

const texts = (n: any, out: string[] = []): string[] => { if (n?.type === "text") out.push(n.value); for (const c of n?.children ?? []) texts(c, out); return out; };
const find = (n: any, pred: (x: any) => boolean): any => (pred(n) ? n : (n?.children ?? []).map((c: any) => find(c, pred)).find(Boolean));

describe("view", () => {
  test("the track shapes: the 300 px cover and the 64 px thumb, artists joined, the position ticks while playing and stops at the end", () => {
    expect(track).toMatchObject({ kind: "track", cover: "https://i/300", thumb: "https://i/64", artist: "Radiohead", album: "In Rainbows" });
    const p = toPlayer({ is_playing: true, progress_ms: 1000, item: { ...track, type: "track", duration_ms: 3000, artists: [{ name: "x" }], id: "t1", uri: "u" }, shuffle_state: false, repeat_state: "bogus" }, 1000)!;
    expect(p.repeat).toBe("off");
    expect(positionOf(p, 1500)).toBe(1500);
    expect(positionOf(p, 9000)).toBe(3000);
    expect(positionOf({ ...p, playing: false }, 9000)).toBe(1000);
    expect(clock(69.9)).toBe("1:09");
    expect(clock(3725)).toBe("1:02:05");
  });

  test("wide: the cover, the glow in the tint, the title column, the progress in the tag colour, the badges, seven lyric lines with the current one xl and keyed with move", () => {
    const v = checkView(render(base));
    expect(v.title).toBe("Weird Fishes · Radiohead");
    expect(v.keys).toBe("actions");
    expect(find(v.tree, (n) => n.type === "image")).toMatchObject({ src: "data:image/jpeg;base64,AAAA", width: 208, height: 208, mask: "rounded" });
    expect(find(v.tree, (n) => n.type === "gradient")).toMatchObject({ layers: [{ stops: ["#e678145c", "#e6781400"], direction: "down" }] });
    expect(find(v.tree, (n) => n.type === "progress")).toMatchObject({ value: 70 / 318, color: "amber" });
    const badges = find(v.tree, (n) => n.key === "badges").children.map((b: any) => b.text);
    expect(badges).toEqual(["shuffle", "repeat", "liked", "hornet 40%"]);
    const col = find(v.tree, (n) => n.key === "lyrics-synced");
    expect(col.children).toHaveLength(7);
    expect(col.children.map((c: any) => c.key)).toEqual(["intro", "l0", "l1", "l2", "l3", "l4", "l5"]);
    const cur = col.children[3];
    expect(cur.transition).toEqual({ move: true, enter: "fade", exit: "fade" });
    expect(cur.children[0]).toMatchObject({ type: "text", value: "Your eyes", size: "xl", weight: "semibold" });
    expect(col.children[2].children[0]).toMatchObject({ value: "The bottom of the sea", size: "lg", color: "muted" });
    expect(col.children[4].children[0]).toMatchObject({ value: "♪", color: "faint" });
    expect(col.children[6].transition.enter).toBe("slide-up");
    expect(texts(v.tree)).toContain("1:10");
    expect(texts(v.tree)).toContain("5:18");
  });

  test("the lines move up as the song advances: the same keys at new places, the top one gone, a new one at the bottom", () => {
    const before = find(render(base).tree, (n) => n.key === "lyrics-synced").children.map((c: any) => c.key);
    const after = find(render({ ...base, position: 77 }).tree, (n) => n.key === "lyrics-synced").children.map((c: any) => c.key);
    expect(before).toEqual(["intro", "l0", "l1", "l2", "l3", "l4", "l5"]);
    expect(after).toEqual(["l0", "l1", "l2", "l3", "l4", "l5", "post6"]);
  });

  test("compact: the cover in the header row with the titles cut to the width, no glow band, four lines (one before, two after) with the current one taller, the transport and the state rows with their keycaps; no lyrics is a line and the lrclib action; unsynced lyrics scroll with the position; an intro shows the note", () => {
    const c = checkView(render({ ...base, layout: "compact" }));
    expect(find(c.tree, (n) => n.type === "image")).toMatchObject({ width: 64, height: 64 });
    expect(find(c.tree, (n) => n.type === "gradient")).toBeUndefined();
    expect(find(c.tree, (n) => n.key === "titles").children.map((t: any) => t.width)).toEqual([320, 320, 320]);
    expect(find(c.tree, (n) => n.type === "progress").width).toBe(396 - 72 - 16);
    const lines = find(c.tree, (n) => n.key === "lyrics-synced");
    expect(lines.children.map((x: any) => [x.key, x.minHeight])).toEqual([["l1", 24], ["l2", 32], ["l3", 24], ["l4", 24]]);
    expect(lines.children[0].children[0]).toMatchObject({ value: "The bottom of the sea", size: "md", color: "muted" });
    expect(lines.children[1].children[0]).toMatchObject({ value: "Your eyes", size: "xl", weight: "semibold" });
    const keycaps = (n: any): string[] => (n?.type === "keycap" ? [n.keys] : (n?.children ?? []).flatMap(keycaps));
    expect(keycaps(find(c.tree, (n) => n.key === "transport"))).toEqual(["space", "cmd+left", "cmd+right", "left", "right", "up", "down"]);
    const state = find(c.tree, (n) => n.key === "state");
    expect(keycaps(state)).toEqual(["l", "d", "q"]);
    expect(texts(state)).toEqual(["♥ liked", "hornet 40%", "queue"]);
    expect(state.children.filter((x: any) => x.type === "badge").map((x: any) => x.text)).toEqual(["shuffle", "repeat"]);
    expect(find(c.tree, (n) => n.key === "badges")).toBeUndefined();
    expect(texts(find(render({ ...base, layout: "compact", playing: false, liked: false }).tree, (n) => n.key === "state"))).toContain("♡ like");
    expect(find(render({ ...base, layout: "compact", playing: false }).tree, (n) => n.key === "paused")).toBeTruthy();
    const none = checkView(render({ ...base, lyrics: null }));
    expect(texts(none.tree)).toContain("No lyrics on lrclib");
    expect(none.actions.find((a) => a.id === "lrclib")).toMatchObject({ shortcut: "f" });
    expect(actions(base).find((a) => a.id === "lrclib")).toBeUndefined();
    const plain = checkView(render({ ...base, position: 159, lyrics: { plain: Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") } }));
    const col = find(plain.tree, (n) => n.key === "lyrics-plain");
    expect(col.children.map((x: any) => x.key)).toEqual(["p7", "p8", "p9", "p10", "p11", "p12", "p13", "unsynced-note"]);
    expect(col.children[3].children[0].value).toBe("line 10");
    const loading = render({ ...base, lyrics: undefined });
    expect(texts(loading.tree)).toContain("Looking for lyrics");
    const intro = find(render({ ...base, position: 10 }).tree, (n) => n.key === "lyrics-synced");
    expect(intro.children[3].children[0].value).toBe("♪");
    expect(checkView(render({ ...base, cover: undefined, tint: undefined })).tree).toBeTruthy();
  });

  test("actions: Enter is play or pause, the bare keys are the spec's, copy names the line when there are synced lyrics", () => {
    const a = actions(base);
    expect(a[0]).toMatchObject({ id: "toggle", title: "Pause", shortcut: "space" });
    expect(Object.fromEntries(a.map((x) => [x.id, x.shortcut]))).toMatchObject({ forward: "right", back: "left", "vol-up": "up", "vol-down": "down", like: "l", shuffle: "s", repeat: "r", queue: "q", devices: "d", copy: "cmd+c", open: "cmd+o", next: "cmd+right", previous: "cmd+left" });
    expect(a.find((x) => x.id === "copy")!.title).toBe("Copy current line");
    expect(actions({ ...base, lyrics: null }).find((x) => x.id === "copy")!.title).toBe("Copy track");
    expect(actions({ ...base, playing: false, liked: false, shuffle: false, repeat: "off" }).map((x) => x.title).slice(0, 1)).toEqual(["Play"]);
    expect(actions({ ...base, repeat: "context" }).find((x) => x.id === "repeat")!.title).toBe("Repeat one");
    for (const kind of ["client_id", "signed_out", "nothing", "no_device", "offline", "limited", "error"] as const) {
      const v = checkView(render({ ...base, track: undefined, status: { kind } }));
      expect(v.actions[0].id).toBe(kind === "client_id" ? "settings" : kind === "signed_out" ? "signin" : kind === "nothing" ? "open-app" : "retry");
      expect(v.title).toBe("Now Playing");
    }
  });
});
