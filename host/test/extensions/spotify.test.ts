// Spotify against three local mocks: api.spotify.com (`PAL_SPOTIFY_API`),
// accounts.spotify.com (`PAL_SPOTIFY_ACCOUNTS`, the PKCE token endpoint
// checking S256 of the verifier against the challenge the authorize url
// carried) and lrclib.net (`PAL_LRCLIB`). The sign-in flow end to end
// through the extension's loopback listener, the token refresh on a 401,
// a 429 honoured, search sectioning, playlists and the drill-in, a track
// added to one from the bar's select, the library filters, devices, the
// queue, the root commands, the lyrics view and its keys, and the bar item
// with its popover ticking.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encode } from "../../../extensions/spotify/node_modules/jpeg-js/index.js";
import { challenge } from "../../../extensions/spotify/auth.ts";
import { Host, stored } from "../harness.ts";

// ---- fixtures -----------------------------------------------------------------

let apiPort = 0;
const apiBase = () => `http://127.0.0.1:${apiPort}`;
// The API mock first: the fixtures below carry its port in their cover urls (the handler reads them only per request).
const api = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname + url.search;
    if (url.pathname.startsWith("/cover/")) {
      const id = url.pathname.slice(7).replace(/-\d+\.jpg$/, "");
      return COVERS[id] ? new Response(COVERS[id], { headers: { "content-type": "image/jpeg" } }) : new Response("no", { status: 404 });
    }
    const rec: Seen = { method: req.method, path, auth: req.headers.get("authorization") };
    if (req.method !== "GET") { try { rec.body = await req.json(); } catch {} }
    seen.push(rec);
    if (rec.auth !== `Bearer ${state.access}`) return spotifyError(401, "The access token expired");
    if (state.limit) { const s = state.limit; state.limit = 0; return new Response(null, { status: 429, headers: { "retry-after": String(s) } }); }
    const p = url.pathname;
    if (p === "/v1/me") return json({ id: "zcag", display_name: "Cagdas", product: "premium" });
    // The position stands still (the tests know where the lines are) unless a test lets the clock run (`advanceFrom`).
    if (p === "/v1/me/player" && req.method === "GET") return state.player ? json({ ...state.player, progress_ms: state.player.progress_ms + (state.advanceFrom && state.player.is_playing ? Date.now() - state.advanceFrom : 0) }) : new Response(null, { status: 204 });
    if (p === "/v1/me/player" && req.method === "PUT") { const d = DEVICES.find((x) => x.id === rec.body?.device_ids?.[0]); if (state.player && d) state.player = { ...state.player, device: d }; return new Response(null, { status: 204 }); }
    if (p === "/v1/me/player/devices") return json({ devices: DEVICES });
    if (p === "/v1/me/player/queue" && req.method === "GET") return json({ currently_playing: state.player?.item ?? null, queue: state.queue });
    if (p === "/v1/me/player/queue" && req.method === "POST") return new Response(null, { status: 204 });
    if (p === "/v1/me/player/play") { if (!state.player) return spotifyError(404, "Player command failed: No active device found", "NO_ACTIVE_DEVICE"); state.player = { ...state.player, is_playing: true }; return new Response(null, { status: 204 }); }
    if (p === "/v1/me/player/pause") { if (state.player) state.player = { ...state.player, is_playing: false }; return new Response(null, { status: 204 }); }
    if (p === "/v1/me/player/next" || p === "/v1/me/player/previous") return new Response(null, { status: 204 });
    if (p === "/v1/me/player/seek") { if (state.player) state.player = { ...state.player, progress_ms: Number(url.searchParams.get("position_ms")) }; return new Response(null, { status: 204 }); }
    if (p === "/v1/me/player/volume") { const v = Number(url.searchParams.get("volume_percent")); if (state.player) state.player = { ...state.player, device: { ...state.player.device, volume_percent: v } }; return new Response(null, { status: 204 }); }
    if (p === "/v1/me/player/shuffle") { if (state.player) state.player = { ...state.player, shuffle_state: url.searchParams.get("state") === "true" }; return new Response(null, { status: 204 }); }
    if (p === "/v1/me/player/repeat") { if (state.player) state.player = { ...state.player, repeat_state: url.searchParams.get("state") }; return new Response(null, { status: 204 }); }
    if (p === "/v1/search") {
      const q = url.searchParams.get("q") ?? "";
      if (q === "nothing") return json({ tracks: { items: [] }, artists: { items: [] }, albums: { items: [] }, playlists: { items: [] }, shows: { items: [] }, episodes: { items: [] } });
      return json({ tracks: { items: [WEIRD, NUDE] }, artists: { items: [ARTIST] }, albums: { items: [ALBUM] }, playlists: { items: [PLAYLISTS[0], null] }, shows: { items: [SHOW] }, episodes: { items: [EPISODE] } });
    }
    if (p === "/v1/me/playlists") return json({ items: PLAYLISTS, next: null });
    if (/^\/v1\/playlists\/[^/]+\/tracks$/.test(p) && req.method === "POST") return state.forbid ? spotifyError(403, "Insufficient client scope") : json({ snapshot_id: "snap" }, { status: 201 });
    if (p === "/v1/playlists/p1/tracks") return json({ items: [{ added_at: "2026-09-01T00:00:00Z", track: NUDE }, { added_at: "2026-09-02T00:00:00Z", track: RECKONER }, { track: null }], next: null });
    if (p === "/v1/albums/al1") return json({ ...ALBUM, tracks: { items: [{ id: "t1", uri: "spotify:track:t1", type: "track", name: "Weird Fishes/ Arpeggi", duration_ms: 318_000, artists: [{ name: "Radiohead" }] }] } });
    if (p === "/v1/me/tracks" && req.method === "GET") return json({ items: [{ added_at: "2026-09-10T10:00:00Z", track: NUDE }, { added_at: "2026-08-01T10:00:00Z", track: BLUE }], next: null });
    if (p === "/v1/me/tracks/contains") return json((url.searchParams.get("ids") ?? "").split(",").map((id) => state.liked.has(id)));
    if (p === "/v1/me/tracks" && req.method === "PUT") { for (const id of (url.searchParams.get("ids") ?? "").split(",")) state.liked.add(id); return new Response(null, { status: 200 }); }
    if (p === "/v1/me/tracks" && req.method === "DELETE") { for (const id of (url.searchParams.get("ids") ?? "").split(",")) state.liked.delete(id); return new Response(null, { status: 200 }); }
    if (p === "/v1/me/player/recently-played") return json({ items: [{ played_at: "2026-09-16T18:00:00Z", track: BLUE }, { played_at: "2026-09-16T17:00:00Z", track: WEIRD }, { played_at: "2026-09-16T16:00:00Z", track: BLUE }] });
    if (p === "/v1/me/top/tracks") return json({ items: [RECKONER, WEIRD] });
    if (p === "/v1/me/top/artists") return json({ items: [ARTIST] });
    return spotifyError(404, `no fixture for ${req.method} ${p}`);
  },
});
apiPort = api.port!;

const img = (id: string) => [640, 300, 64].map((h) => ({ url: `${apiBase()}/cover/${id}-${h}.jpg`, height: h, width: h }));
const track = (id: string, name: string, artist: string, album: string, duration = 318_000, extra: Record<string, unknown> = {}) => ({
  id, uri: `spotify:track:${id}`, type: "track", name, duration_ms: duration, explicit: false, external_urls: { spotify: `https://open.spotify.com/track/${id}` },
  artists: [{ name: artist, id: `a-${artist}` }], album: { name: album, id: `al-${album}`, images: img(album.toLowerCase().replace(/\W+/g, "")) }, ...extra,
});
const WEIRD = track("t1", "Weird Fishes/ Arpeggi", "Radiohead", "In Rainbows");
const NUDE = track("t2", "Nude", "Radiohead", "In Rainbows", 255_000);
const RECKONER = track("t3", "Reckoner", "Radiohead", "In Rainbows", 290_000);
const BLUE = track("t4", "Blue Monday", "New Order", "Power, Corruption & Lies", 448_000, { explicit: true });
const ARTIST = { id: "ar1", uri: "spotify:artist:ar1", name: "Radiohead", type: "artist", genres: ["art rock", "alternative"], followers: { total: 12_345_678 }, images: img("radiohead"), external_urls: { spotify: "https://open.spotify.com/artist/ar1" } };
const ALBUM = { id: "al1", uri: "spotify:album:al1", name: "In Rainbows", type: "album", album_type: "album", release_date: "2007-10-10", total_tracks: 10, artists: [{ name: "Radiohead" }], images: img("inrainbows"), external_urls: { spotify: "https://open.spotify.com/album/al1" } };
const PLAYLISTS = [
  { id: "p1", uri: "spotify:playlist:p1", name: "Focus", owner: { id: "zcag", display_name: "Cagdas" }, tracks: { total: 42 }, images: img("focus"), description: "Deep work", collaborative: false, external_urls: { spotify: "https://open.spotify.com/playlist/p1" } },
  { id: "p2", uri: "spotify:playlist:p2", name: "Discover Weekly", owner: { id: "spotify", display_name: "Spotify" }, tracks: { total: 30 }, images: img("discover"), description: "", collaborative: false, external_urls: { spotify: "https://open.spotify.com/playlist/p2" } },
  { id: "p3", uri: "spotify:playlist:p3", name: "Road Trip", owner: { id: "ayse", display_name: "Ayse" }, tracks: { total: 12 }, images: [], description: "", collaborative: true, external_urls: { spotify: "https://open.spotify.com/playlist/p3" } },
];
const SHOW = { id: "s1", uri: "spotify:show:s1", name: "Conan O'Brien Needs A Friend", type: "show", publisher: "Team Coco", images: img("conan"), external_urls: { spotify: "https://open.spotify.com/show/s1" } };
const EPISODE = { id: "e1", uri: "spotify:episode:e1", name: "Taylor Tomlinson", type: "episode", duration_ms: 3_963_000, images: img("conan"), external_urls: { spotify: "https://open.spotify.com/episode/e1" } };
const DEVICES = [
  { id: "d1", name: "hornet", type: "Computer", is_active: true, volume_percent: 40, is_restricted: false, supports_volume: true },
  { id: "d2", name: "Kitchen", type: "Speaker", is_active: false, volume_percent: 70, is_restricted: false, supports_volume: true },
  { id: "d3", name: "marvin", type: "Smartphone", is_active: false, volume_percent: null, is_restricted: false, supports_volume: false },
];
const LRC = "[00:58.19] In the deepest ocean\n[01:04.07] The bottom of the sea\n[01:09.72] Your eyes\n[01:16.14] They turn me\n[01:23.23] Why should I stay here?\n";
/** A 16 by 16 JPEG of one colour, for the covers: the sampler must find it. */
const jpeg = (rgb: [number, number, number]) => { const d = new Uint8Array(16 * 16 * 4); for (let i = 0; i < 256; i++) d.set([...rgb, 255], i * 4); return new Uint8Array(encode({ width: 16, height: 16, data: d }, 90).data); };
const COVERS: Record<string, Uint8Array> = { inrainbows: jpeg([230, 120, 20]), powercorruptionlies: jpeg([40, 80, 200]) };

// ---- the mocks --------------------------------------------------------------------

type Seen = { method: string; path: string; body?: any; auth?: string | null };
const seen: Seen[] = [];
const calls = (method: string, prefix: string) => seen.filter((s) => s.method === method && s.path.startsWith(prefix));
let state: { player: any | null; access: string; refresh: string; limit: number; queue: any[]; liked: Set<string>; challenge?: string; issued: number; advanceFrom?: number; forbid?: boolean } = { player: null, access: "access-1", refresh: "refresh-1", limit: 0, queue: [], liked: new Set(["t2"]), issued: 0 };
const json = (data: unknown, init: ResponseInit = {}) => Response.json(data, init);
const spotifyError = (status: number, message: string, reason?: string) => json({ error: { status, message, reason } }, { status });


const accounts = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/api/token" || req.method !== "POST") return new Response("no", { status: 404 });
    const form = new URLSearchParams(await req.text());
    seen.push({ method: "POST", path: "/api/token", body: Object.fromEntries(form) });
    if (form.get("grant_type") === "authorization_code") {
      if (form.get("code") !== "the-code" || form.get("client_id") !== "client-abc") return json({ error: "invalid_grant", error_description: "bad code" }, { status: 400 });
      if (challenge(form.get("code_verifier") ?? "") !== state.challenge) return json({ error: "invalid_grant", error_description: "code_verifier does not match" }, { status: 400 });
      state.issued++;
      return json({ access_token: state.access, token_type: "Bearer", scope: "user-read-playback-state", expires_in: 3600, refresh_token: state.refresh });
    }
    if (form.get("grant_type") === "refresh_token") {
      if (form.get("refresh_token") !== state.refresh) return json({ error: "invalid_grant", error_description: "Refresh token revoked" }, { status: 400 });
      state.access = `access-${state.issued + 1}`; state.refresh = `refresh-${state.issued + 1}`; state.issued++;
      return json({ access_token: state.access, token_type: "Bearer", expires_in: 3600, refresh_token: state.refresh });
    }
    return json({ error: "unsupported_grant_type" }, { status: 400 });
  },
});

let lrclibAsked = 0;
const lrclib = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    lrclibAsked++;
    if (url.pathname === "/api/get") {
      if (url.searchParams.get("track_name") === "Weird Fishes/ Arpeggi") return json({ id: 34666, trackName: "Weird Fishes/ Arpeggi", artistName: "Radiohead", albumName: "In Rainbows", duration: 318, instrumental: false, plainLyrics: "In the deepest ocean\n...", syncedLyrics: LRC });
      return json({ statusCode: 404, name: "TrackNotFound" }, { status: 404 });
    }
    if (url.pathname === "/api/search") {
      if (url.searchParams.get("track_name") === "Nude") return json([{ id: 1, trackName: "Nude", artistName: "Radiohead", albumName: "Live", duration: 300, instrumental: false, plainLyrics: "Don't get any big ideas\nThey're not gonna happen", syncedLyrics: null }, { id: 2, trackName: "Nude", artistName: "Radiohead", albumName: "In Rainbows", duration: 256, instrumental: false, plainLyrics: "Don't get any big ideas", syncedLyrics: null }]);
      return json([]);
    }
    return new Response("no", { status: 404 });
  },
});

const REDIRECT_PORT = 30000 + Math.floor(Math.random() * 20000);
let host: Host;
const effects: unknown[] = [];
const refreshes: string[] = [];

beforeAll(async () => {
  stored.clear();
  process.env.PAL_SPOTIFY_API = apiBase();
  process.env.PAL_SPOTIFY_ACCOUNTS = `http://127.0.0.1:${accounts.port}`;
  process.env.PAL_LRCLIB = `http://127.0.0.1:${lrclib.port}`;
  process.env.PAL_SPOTIFY_TICK_MS = "2500";
  process.env.PAL_SPOTIFY_SYNC_MS = "800";
  host = await Host.bundled({
    settings: { spotify: { settings: { client_id: "client-abc", redirect_port: REDIRECT_PORT, pinned: ["Focus", "spotify:playlist:p2", "No Such List"] } } },
    core: { "effects.run": (p: unknown) => { effects.push(p); return null; }, "bar.refresh": (p: any) => { refreshes.push(p.id); return null; } },
  });
});
afterAll(() => { host.kill(); api.stop(true); accounts.stop(true); lrclib.stop(true); });

const list = (palette: string, query?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("spotify", palette, query, ctx);
const pick = (palette: string, id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("spotify", palette, id, action, ctx);
const ids = (items: { id: string }[]) => items.map((i) => i.id);
const find = (n: any, pred: (x: any) => boolean): any => (pred(n) ? n : (n?.children ?? []).map((c: any) => find(c, pred)).find(Boolean));
const texts = (n: any, out: string[] = []): string[] => { if (n?.type === "text") out.push(n.value); for (const c of n?.children ?? []) texts(c, out); return out; };
const lyricLines = (tree: any) => find(tree, (n) => n.key === "lyrics-synced").children.map((c: any) => c.children[0]?.value ?? "");

describe("spotify", () => {
  test("meta: seven palettes, the view, the input one, the live ones, the primary commands, the bar item on the media trigger; no load warnings", () => {
    const l = host.loaded().find((x) => x.extension === "spotify")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((m) => [m.name, m.input, m.live, m.view ?? "list"])).toEqual([
      ["now-playing", true, false, "view"], ["search", true, false, "list"], ["playlists", false, false, "list"], ["library", false, false, "list"], ["devices", false, true, "list"], ["queue", false, true, "list"], ["commands", false, false, "list"],
    ]);
    expect(l.palettes.find((m) => m.name === "commands")).toMatchObject({ tier: "primary", title: "Spotify" });
    expect(l.palettes.find((m) => m.name === "library")!.filters!.map((f) => f.id)).toEqual(["liked", "recent", "top-tracks", "top-artists"]);
    expect(l.palettes.find((m) => m.name === "now-playing")).toMatchObject({ title: "Lyrics", suggest: true });
    expect(l.bar).toEqual([expect.objectContaining({
      id: "playing", title: "Spotify", description: expect.any(String), refresh: { every: 30, on: ["show", "wake", "network", "media" as never] }, keys: expect.arrayContaining([{ keys: "space", title: expect.any(String) }]), source: true,
      mocks: expect.objectContaining({ lyrics: expect.objectContaining({ title: "Synced lyric line" }), track: expect.objectContaining({ title: "No synced lyrics" }), paused: expect.objectContaining({ item: { hidden: true, empty: { icon: "\u{f04c7}", tooltip: "Nothing playing" } } }) }),
    })]);
    expect(host.manifests.get("spotify")!.settings!.map((s) => [s.id, s.kind])).toEqual([["client_id", "text"], ["redirect_port", "number"], ["bar_lyrics", "boolean"], ["bar_show", "select"], ["pinned", "list"]]);
  });

  describe("sign-in", () => {
    test("signed out: every listing is one Sign in row, the view says so, the bar item is hidden, and no request reaches the API", async () => {
      seen.length = 0;
      const [row] = await list("search", "radiohead");
      expect(row).toMatchObject({ id: "hint:signin", name: "Sign in to Spotify", actions: [{ id: "signin", title: "Sign in to Spotify" }] });
      expect((await list("playlists"))[0].id).toBe("hint:signin");
      const v = await host.request<any>("view", { extension: "spotify", palette: "now-playing" });
      expect(v.actions[0]).toMatchObject({ id: "signin" });
      expect(texts(v.tree)).toContain("Sign in to Spotify");
      // Signed out: hidden, the glyph and the popover's sign-in row its empty shape (no API call for it).
      expect(await host.render("spotify", "playing")).toMatchObject({ hidden: true, empty: { icon: "\u{f04c7}", tooltip: "Sign in to Spotify" } });
      expect(seen.filter((s) => s.path.startsWith("/v1"))).toHaveLength(0);
      // The root commands still list (they need no token); the pinned rows and Sign out do not.
      expect(ids(await list("commands"))).toEqual(["toggle", "next", "previous", "like", "lyrics"]);
    });

    test("the flow: Enter on the row opens the authorize url and pal listens; the redirect exchanges the code with PKCE, stores the tokens, tells the HUD and renders the bar item again", async () => {
      const r = await pick("search", "hint:signin");
      const url = new URL(r.open!);
      expect(url.origin).toBe(`http://127.0.0.1:${accounts.port}`);
      expect(url.pathname).toBe("/authorize");
      const q = Object.fromEntries(url.searchParams);
      expect(q).toMatchObject({ client_id: "client-abc", response_type: "code", redirect_uri: `http://127.0.0.1:${REDIRECT_PORT}/callback`, code_challenge_method: "S256" });
      expect(q.scope.split(" ")).toEqual(expect.arrayContaining(["user-read-playback-state", "user-modify-playback-state", "user-library-modify", "playlist-read-private", "user-read-recently-played", "user-top-read"]));
      expect(q.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(r.toast).toMatchObject({ title: "Finish signing in in the browser" });
      state.challenge = q.code_challenge;
      // A wrong state is refused before any exchange.
      const bad = await fetch(`http://127.0.0.1:${REDIRECT_PORT}/callback?code=the-code&state=nope`);
      expect(bad.status).toBe(400);
      // The browser comes back.
      const ok = await fetch(`http://127.0.0.1:${REDIRECT_PORT}/callback?code=the-code&state=${q.state}`);
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain("Signed in to Spotify");
      const exchange = seen.find((s) => s.path === "/api/token")!;
      expect(exchange.body).toMatchObject({ grant_type: "authorization_code", code: "the-code", redirect_uri: `http://127.0.0.1:${REDIRECT_PORT}/callback`, client_id: "client-abc" });
      expect(exchange.body.client_secret).toBeUndefined();
      await host.until(() => effects.length > 0 && refreshes.includes("playing"), 3000, "hud and bar refresh");
      expect(effects[0]).toEqual({ effect: { hud: "Signed in to Spotify" } });
      expect(stored.get("spotify\0auth")).toMatchObject({ access: "access-1", refresh: "refresh-1" });
      // The listener is gone with the sign-in.
      await expect(fetch(`http://127.0.0.1:${REDIRECT_PORT}/callback`)).rejects.toThrow();
    });

    test("a 401 refreshes the token once, the rotated refresh token is kept, and the call succeeds", async () => {
      seen.length = 0;
      state.access = "access-expired-on-server";
      const items = await list("playlists");
      expect(ids(items)).toEqual(["playlist:p1", "playlist:p2", "playlist:p3"]);
      const refresh = seen.find((s) => s.path === "/api/token")!;
      expect(refresh.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1", client_id: "client-abc" });
      expect(stored.get("spotify\0auth")).toMatchObject({ access: state.access, refresh: state.refresh });
      expect(state.refresh).toBe("refresh-2");
    });
  });

  describe("rate limit", () => {
    test("a 429 with a long Retry-After is the hint with its time, and the next call is refused locally without a request", async () => {
      seen.length = 0;
      state.limit = 30;
      const [row] = await list("playlists", undefined, { refresh: true });
      expect(row).toMatchObject({ id: "hint:limited", name: "Spotify rate limit reached" });
      expect(row.subtitle).toMatch(/try again in \d+ s/);
      const before = seen.length;
      const [again] = await list("library");
      expect(again.id).toBe("hint:limited");
      expect(seen.length).toBe(before);
      // Time cannot pass here; a fresh host would honour the same clock. The limit is a module value, so the rest of the file runs on a new host.
    });
  });
});

describe("spotify, signed in", () => {
  let h: Host;
  beforeAll(async () => {
    host.kill();
    h = host = await Host.bundled({
      settings: { spotify: { settings: { client_id: "client-abc", redirect_port: REDIRECT_PORT, pinned: ["Focus", "spotify:playlist:p2", "No Such List"] } } },
      core: { "effects.run": (p: unknown) => { effects.push(p); return null; }, "bar.refresh": (p: any) => { refreshes.push(p.id); return null; } },
    });
    state.player = { device: DEVICES[0], shuffle_state: false, repeat_state: "off", progress_ms: 70_000, is_playing: true, item: WEIRD, currently_playing_type: "track", context: { uri: "spotify:album:al1" } };
    state.queue = [NUDE, RECKONER, BLUE];
    seen.length = 0;
  });

  describe("search", () => {
    test("sections in order with cover art icons, a null playlist skipped, the like state fetched once, the actions per kind", async () => {
      const items = await list("search", "radiohead");
      expect(items.map((i) => i.section)).toEqual(["Tracks", "Tracks", "Artists", "Albums", "Playlists", "Podcasts", "Episodes"]);
      expect(ids(items)).toEqual(["track:t1", "track:t2", "artist:ar1", "album:al1", "playlist:p1", "show:s1", "episode:e1"]);
      const [weird, nude, artist, album, playlist, show, episode] = items;
      expect(weird).toMatchObject({ name: "Weird Fishes/ Arpeggi", subtitle: "Radiohead · In Rainbows", icon: { image: `${apiBase()}/cover/inrainbows-64.jpg` }, accessories: [{ text: "5:18" }] });
      expect(weird.actions!.map((a) => [a.id, a.shortcut, a.args])).toEqual([["play", undefined, undefined], ["queue", "cmd+enter", undefined], ["like", "cmd+l", undefined], ["add", "cmd+p", true], ["open", "cmd+o", undefined], ["copy", "cmd+c", undefined]]);
      expect(weird.actions![2].title).toBe("Like");
      // The playlist select on every track row: the user's own and the collaborative one, not the followed one; fetched alongside the search, once.
      expect(weird.args).toEqual([{ id: "playlist", placeholder: "Playlist", kind: "select", required: true, options: [{ id: "p1", title: "Focus" }, { id: "p3", title: "Road Trip" }] }]);
      expect(episode.args).toEqual(weird.args);
      expect(calls("GET", "/v1/me/playlists")).toHaveLength(1);
      expect(nude.actions![2].title).toBe("Unlike");
      expect(artist).toMatchObject({ name: "Radiohead", subtitle: "art rock, alternative", accessories: [{ text: "12.3M followers" }] });
      expect(album).toMatchObject({ subtitle: "Radiohead · 2007", accessories: [{ text: "10 tracks" }] });
      expect(album.actions!.map((a) => a.id)).toEqual(["play", "tracks", "open", "copy"]);
      expect(playlist).toMatchObject({ name: "Focus", subtitle: "Cagdas · Deep work", accessories: [{ text: "42 tracks" }] });
      expect(playlist.actions!.map((a) => a.id)).toEqual(["play", "tracks", "shuffle", "open", "copy"]);
      expect(show).toMatchObject({ name: "Conan O'Brien Needs A Friend", subtitle: "Team Coco" });
      expect(episode.actions!.map((a) => a.id)).toEqual(["play", "queue", "add", "open", "copy"]);
      expect(calls("GET", "/v1/search")).toHaveLength(1);
      expect(calls("GET", "/v1/me/tracks/contains")).toHaveLength(1);
      expect((await list("search", "nothing"))[0]).toMatchObject({ id: "hint:empty", name: "No results" });
      expect((await list("search", "r"))[0].id).toBe("hint:search");
    });

    test("Enter plays the track, cmd+enter queues it, cmd+l likes then unlikes, cmd+o opens the uri, cmd+c copies the link; a container plays as the context", async () => {
      expect(await pick("search", "track:t1")).toEqual({ hud: "Playing Weird Fishes/ Arpeggi" });
      expect(calls("PUT", "/v1/me/player/play").at(-1)!.body).toEqual({ uris: ["spotify:track:t1"] });
      expect(await pick("search", "track:t1", "queue")).toMatchObject({ keep: true, toast: { title: "Added to queue" } });
      expect(calls("POST", "/v1/me/player/queue").at(-1)!.path).toBe("/v1/me/player/queue?uri=spotify%3Atrack%3At1");
      expect(await pick("search", "track:t1", "like")).toMatchObject({ toast: { title: "Added to Liked Songs", message: "Weird Fishes/ Arpeggi" } });
      expect(calls("PUT", "/v1/me/tracks?ids=t1")).toHaveLength(1);
      expect(await pick("search", "track:t1", "like")).toMatchObject({ toast: { title: "Removed from Liked Songs" } });
      expect(calls("DELETE", "/v1/me/tracks?ids=t1")).toHaveLength(1);
      expect(await pick("search", "track:t1", "open")).toEqual({ open: "spotify:track:t1" });
      expect(await pick("search", "track:t1", "copy")).toEqual({ copy: "https://open.spotify.com/track/t1" });
      expect(await pick("search", "album:al1")).toEqual({ hud: "Playing In Rainbows" });
      expect(calls("PUT", "/v1/me/player/play").at(-1)!.body).toEqual({ context_uri: "spotify:album:al1" });
      expect(await pick("search", "playlist:p1", "shuffle")).toEqual({ hud: "Playing Focus shuffled" });
      expect(calls("PUT", "/v1/me/player/shuffle?state=true")).toHaveLength(1);
      // A row the table never saw (a restart) still plays: the id says what it is.
      expect(await pick("search", "track:zz")).toEqual({ hud: "Playing track" });
    });

    test("Add to playlist: the playlist picked in the bar gets the uri posted; without values a form with the same select; a placeholder option and a 403 are failure toasts", async () => {
      expect(await pick("search", "track:t1", "add", { values: { playlist: "p3" } })).toMatchObject({ keep: true, toast: { title: "Added to Road Trip", message: "Weird Fishes/ Arpeggi" } });
      const posted = calls("POST", "/v1/playlists/p3/tracks");
      expect(posted).toHaveLength(1);
      expect(posted[0].body).toEqual({ uris: ["spotify:track:t1"] });
      expect(calls("POST", "/v1/playlists/p1/tracks")).toHaveLength(0);
      // The count follows without another read of the playlists.
      expect((await list("playlists")).find((p) => p.id === "playlist:p3")!.accessories![0]).toEqual({ text: "13 tracks" });
      expect(calls("GET", "/v1/me/playlists")).toHaveLength(1);
      const form = (await pick("search", "track:t1", "add")).form!;
      expect(form).toMatchObject({ title: "Add Weird Fishes/ Arpeggi", submit: { id: "add", title: "Add" } });
      expect(form.fields).toEqual([{ kind: "select", id: "playlist", label: "Playlist", options: [{ id: "p1", title: "Focus" }, { id: "p3", title: "Road Trip" }], required: true, default: undefined }]);
      // A followed playlist is not offered, so its id is refused before any request.
      expect(await pick("search", "track:t1", "add", { values: { playlist: "p2" } })).toMatchObject({ toast: { title: "Pick a playlist", style: "failure" } });
      expect(calls("POST", "/v1/playlists/p2/tracks")).toHaveLength(0);
      state.forbid = true;
      const r = await pick("search", "track:t1", "add", { values: { playlist: "p1" } });
      expect(r.toast).toMatchObject({ title: "Could not add to the playlist", style: "failure" });
      expect(r.toast!.message).toMatch(/Insufficient client scope.*Sign out and in again/);
      state.forbid = false;
      // An artist row has no playlist to go into.
      expect(await pick("search", "artist:ar1", "add", { values: { playlist: "p1" } })).toEqual({ keep: true });
    });
  });

  describe("playlists", () => {
    test("yours and followed by owner, the drill-in lists the tracks and plays from one inside the playlist; an album's tracks too", async () => {
      const items = await list("playlists");
      expect(items.map((i) => [i.id, i.section])).toEqual([["playlist:p1", "Yours"], ["playlist:p2", "Followed"], ["playlist:p3", "Followed"]]);
      expect(await pick("playlists", "playlist:p1", "tracks")).toEqual({ push: { extension: "spotify", palette: "playlists", args: { playlist: "p1", name: "Focus" } } });
      const tracks = await list("playlists", undefined, { args: { playlist: "p1" } });
      expect(ids(tracks)).toEqual(["track:t2", "track:t3"]);
      expect(tracks[0].actions![0].title).toBe("Play from here");
      expect(await pick("playlists", "track:t3", undefined, { args: { playlist: "p1" } })).toEqual({ hud: "Playing Reckoner" });
      expect(calls("PUT", "/v1/me/player/play").at(-1)!.body).toEqual({ context_uri: "spotify:playlist:p1", offset: { uri: "spotify:track:t3" } });
      const albumTracks = await list("playlists", undefined, { args: { album: "al1" } });
      expect(albumTracks[0]).toMatchObject({ id: "track:t1", subtitle: "Radiohead · In Rainbows", icon: { image: `${apiBase()}/cover/inrainbows-64.jpg` } });
    });
  });

  describe("library", () => {
    test("liked newest first with the date, recently played deduplicated with the time, top tracks and artists ranked", async () => {
      const liked = await list("library");
      expect(ids(liked)).toEqual(["track:t2", "track:t4"]);
      expect(liked[0].accessories).toEqual([{ text: "4:15" }, { date: "2026-09-10T10:00:00Z" }]);
      expect(liked[1].accessories).toEqual([{ text: "7:28" }, { tag: "E", color: "grey" }, { date: "2026-08-01T10:00:00Z" }]);
      const recent = await list("library", undefined, { filter: "recent" });
      expect(ids(recent)).toEqual(["track:t4", "track:t1"]);
      expect(recent[0].accessories).toEqual([{ text: "7:28" }, { tag: "E", color: "grey" }, { date: "2026-09-16T18:00:00Z" }]);
      const top = await list("library", undefined, { filter: "top-tracks" });
      expect(top.map((t) => [t.id, t.accessories![0]])).toEqual([["track:t3", { text: "#1" }], ["track:t1", { text: "#2" }]]);
      expect(calls("GET", "/v1/me/top/tracks?time_range=short_term")).toHaveLength(1);
      const artists = await list("library", undefined, { filter: "top-artists" });
      expect(artists[0]).toMatchObject({ id: "artist:ar1", accessories: [{ text: "#1" }] });
    });
  });

  describe("devices", () => {
    test("a row per device with its glyph, volume and the active tag; Enter transfers, the volume rows act on the active one", async () => {
      const items = await list("devices");
      expect(ids(items)).toEqual(["device:d1", "device:d2", "device:d3", "volume:up", "volume:down", "volume:mute", "volume:set"]);
      expect(items[6]).toMatchObject({ name: "Set volume…", subtitle: "hornet: a level from 0 to 100, typed in the bar", section: "Volume", args: [{ id: "level", placeholder: "0 to 100", kind: "number", required: true }], actions: [{ id: "run", title: "Set volume" }] });
      expect(items[0]).toMatchObject({ name: "hornet", subtitle: "Computer", icon: "\u{f0322}", accessories: [{ text: "40%" }, { tag: "active", color: "green" }], section: "Devices" });
      expect(items[0].actions!.map((a) => a.id)).toEqual(["vol-up", "vol-down"]);
      expect(items[1]).toMatchObject({ name: "Kitchen", icon: "\u{f04c3}", accessories: [{ text: "70%" }] });
      expect(items[1].actions!.map((a) => a.id)).toEqual(["transfer", "transfer-paused"]);
      expect(items[3]).toMatchObject({ name: "Volume up", subtitle: "hornet: 40% to 50%", section: "Volume" });
      expect(await pick("devices", "device:d2")).toMatchObject({ keep: true, toast: { title: "Playback transferred" } });
      expect(calls("PUT", "/v1/me/player").at(-1)!.body).toEqual({ device_ids: ["d2"], play: true });
      expect(await pick("devices", "device:d3", "transfer-paused")).toMatchObject({ keep: true });
      expect(calls("PUT", "/v1/me/player").at(-1)!.body).toEqual({ device_ids: ["d3"], play: false });
      state.player = { ...state.player, device: DEVICES[0] };
      expect(await pick("devices", "volume:up")).toMatchObject({ keep: true, toast: { title: "hornet at 50%" } });
      expect(calls("PUT", "/v1/me/player/volume?volume_percent=50")).toHaveLength(1);
      expect(await pick("devices", "volume:mute")).toMatchObject({ toast: { title: "hornet at 0%" } });
      state.player = { ...state.player, device: DEVICES[0] };
    });

    test("Set volume: the level typed in the bar goes to the active device as it is; without values a form with the same field; a level off the scale is refused in it", async () => {
      expect(await pick("devices", "volume:set", "run", { values: { level: "23" } })).toMatchObject({ keep: true, toast: { title: "hornet at 23%" } });
      expect(calls("PUT", "/v1/me/player/volume?volume_percent=23")).toHaveLength(1);
      const form = (await pick("devices", "volume:set", "run")).form!;
      expect(form).toMatchObject({ title: "Set volume", submit: { id: "run", title: "Set volume" } });
      expect(form.fields.map((f) => [f.id, f.kind, !!f.required])).toEqual([["level", "text", true]]);
      expect((await pick("devices", "volume:set", "run", { values: { level: "140" } })).form!.errors).toEqual({ level: "A whole number from 0 to 100" });
      expect((await pick("devices", "volume:set", "run", { values: { level: "loud" } })).form!.errors).toEqual({ level: "A whole number from 0 to 100" });
      expect(calls("PUT", "/v1/me/player/volume?volume_percent=140")).toHaveLength(0);
      state.player = { ...state.player, device: DEVICES[0] };
    });
  });

  describe("queue", () => {
    test("the playing track first, then the queue numbered; Enter on the third is three Nexts", async () => {
      const items = await list("queue");
      expect(ids(items)).toEqual(["now:t1", "q:0:t2", "q:1:t3", "q:2:t4"]);
      expect(items[0]).toMatchObject({ section: "Now playing", name: "Weird Fishes/ Arpeggi" });
      expect(items[1]).toMatchObject({ section: "Up next", accessories: [{ text: "#1" }, { text: "4:15" }] });
      expect(items[1].actions![0].title).toBe("Skip to it");
      expect(items[3].actions![0].title).toBe("Skip 3 ahead");
      // The playing row and the queued ones take a playlist in the bar too, and the pick lands on the track.
      expect(items[0].actions!.map((a) => a.id)).toEqual(["toggle", "like", "add", "open", "copy"]);
      expect(items[1].actions!.map((a) => a.id)).toEqual(["skip", "like", "add", "open", "copy"]);
      expect(items[0].args![0].options!.map((o) => o.id)).toEqual(["p1", "p3"]);
      expect(await pick("queue", "q:0:t2", "add", { values: { playlist: "p1" } })).toMatchObject({ toast: { title: "Added to Focus", message: "Nude" } });
      expect(calls("POST", "/v1/playlists/p1/tracks").at(-1)!.body).toEqual({ uris: ["spotify:track:t2"] });
      expect(await pick("queue", "now:t1", "add", { values: { playlist: "p1" } })).toMatchObject({ toast: { title: "Added to Focus", message: "Weird Fishes/ Arpeggi" } });
      const before = calls("POST", "/v1/me/player/next").length;
      expect(await pick("queue", "q:2:t4", "skip")).toMatchObject({ keep: true, toast: { title: "Skipped 3 tracks" } });
      expect(calls("POST", "/v1/me/player/next")).toHaveLength(before + 3);
      expect(await pick("queue", "q:0:t2", "copy")).toEqual({ copy: "https://open.spotify.com/track/t2" });
      state.queue = [];
      state.player = null;
      expect((await list("queue"))[0]).toMatchObject({ id: "hint:empty", name: "The queue is empty" });
      state.player = { device: DEVICES[0], shuffle_state: false, repeat_state: "off", progress_ms: 70_000, is_playing: true, item: WEIRD, currently_playing_type: "track", context: { uri: "spotify:album:al1" } };
      state.queue = [NUDE, RECKONER, BLUE];
    });
  });

  describe("root commands", () => {
    test("the five commands, a Play row per pinned playlist (by name and by uri, a missing one as a hint) and Sign out; the commands answer with the HUD", async () => {
      const items = await list("commands");
      expect(ids(items)).toEqual(["toggle", "next", "previous", "like", "lyrics", "pin:p1", "pin:p2", "hint:pin:No Such List", "signout"]);
      // 44: the pinned rows read the same playlist cache the queue's two adds bumped, no second read of the playlists.
      expect(items[5]).toMatchObject({ name: "Play Focus", subtitle: "Cagdas · 44 tracks", icon: { image: `${apiBase()}/cover/focus-64.jpg` } });
      expect(calls("GET", "/v1/me/playlists")).toHaveLength(1);
      expect(items[6].name).toBe("Play Discover Weekly");
      expect(items[7].actions).toEqual([]);
      expect(await pick("commands", "pin:p1")).toEqual({ hud: "Playing Focus" });
      expect(calls("PUT", "/v1/me/player/play").at(-1)!.body).toEqual({ context_uri: "spotify:playlist:p1" });
      expect(await pick("commands", "next")).toEqual({ hud: "Next track: Weird Fishes/ Arpeggi" });
      expect(await pick("commands", "toggle")).toEqual({ hud: "Paused: Weird Fishes/ Arpeggi" });
      expect(calls("PUT", "/v1/me/player/pause")).toHaveLength(1);
      state.player = { ...state.player, is_playing: true };
      expect(await pick("commands", "like")).toEqual({ hud: "Added to Liked Songs: Weird Fishes/ Arpeggi" });
      // The root row opens the lyrics view, and the view's picks come back to this palette.
      const r = await pick("commands", "lyrics");
      expect(r.view!.id).toBe("now");
      expect((await pick("commands", "now", "open")).open).toBe("spotify:track:t1");
      const suggested = await host.request<any[]>("suggest");
      expect(suggested.find((s) => s.extension === "spotify")!.items[0]).toMatchObject({ id: "now", name: "Weird Fishes/ Arpeggi", subtitle: "Radiohead · Spotify" });
    });
  });

  describe("the lyrics view", () => {
    test("opens on the track with its cover as a data url, the tint from the art, the synced lyrics from lrclib around the line at the position, the like state", async () => {
      const v = await host.request<any>("view", { extension: "spotify", palette: "now-playing" });
      expect(v.title).toBe("Weird Fishes/ Arpeggi · Radiohead");
      const image = find(v.tree, (n: any) => n.type === "image");
      expect(image.src).toMatch(/^data:image\/jpeg;base64,/);
      expect(find(v.tree, (n: any) => n.type === "progress").color).toBe("amber");
      expect(find(v.tree, (n: any) => n.type === "gradient").layers[0].stops[0]).toMatch(/^#[0-9a-f]{6}5c$/);
      // 70 s in: "Your eyes" (1:09.72) is the line, the two before muted, the two after faint.
      const lines = lyricLines(v.tree);
      expect(lines).toEqual(["♪", "In the deepest ocean", "The bottom of the sea", "Your eyes", "They turn me", "Why should I stay here?", ""]);
      expect(find(v.tree, (n: any) => n.key === "l2").children[0]).toMatchObject({ size: "xl", weight: "semibold" });
      expect(find(v.tree, (n: any) => n.key === "badges").children.map((b: any) => b.text)).toEqual(["liked", "hornet 40%"]);
      expect(lrclibAsked).toBe(1);
      // Asked again: the lyrics and the cover come from the caches, lrclib is not asked twice.
      await host.request<any>("view", { extension: "spotify", palette: "now-playing" });
      expect(lrclibAsked).toBe(1);
    });

    test("the keys: space pauses (the badge follows at once), right seeks 10 s on, up raises the volume, s and r flip, l unlikes, cmd+c copies the line, q pushes the queue", async () => {
      const toggle = await pick("now-playing", "now", "toggle");
      expect(calls("PUT", "/v1/me/player/pause")).toHaveLength(2);
      expect(find(toggle.view!.tree, (n: any) => n.key === "badges").children[0].text).toBe("paused");
      expect(toggle.view!.actions[0].title).toBe("Play");
      const fwd = await pick("now-playing", "now", "forward");
      const seek = calls("PUT", "/v1/me/player/seek").at(-1)!;
      const to = Number(new URL(`http://x${seek.path}`).searchParams.get("position_ms"));
      expect(to).toBeGreaterThanOrEqual(80_000);
      expect(to).toBeLessThan(82_000);
      expect(lyricLines(fwd.view!.tree)[3]).toBe("They turn me");
      await pick("now-playing", "now", "vol-up");
      expect(calls("PUT", "/v1/me/player/volume?volume_percent=45")).toHaveLength(1);
      const sh = await pick("now-playing", "now", "shuffle");
      expect(calls("PUT", "/v1/me/player/shuffle?state=true").length).toBeGreaterThanOrEqual(2);
      expect(find(sh.view!.tree, (n: any) => n.key === "badges").children.map((b: any) => b.text)).toContain("shuffle");
      const rp = await pick("now-playing", "now", "repeat");
      expect(calls("PUT", "/v1/me/player/repeat?state=context")).toHaveLength(1);
      expect(rp.view!.actions.find((a: any) => a.id === "repeat")!.title).toBe("Repeat one");
      const un = await pick("now-playing", "now", "like");
      expect(un.toast).toMatchObject({ title: "Removed from Liked Songs" });
      expect(await pick("now-playing", "now", "copy")).toEqual({ copy: "They turn me" });
      expect(await pick("now-playing", "now", "queue")).toEqual({ push: { extension: "spotify", palette: "queue" } });
      expect(await pick("now-playing", "now", "devices")).toEqual({ push: { extension: "spotify", palette: "devices" } });
      expect(await pick("now-playing", "now", "open")).toEqual({ open: "spotify:track:t1" });
      state.player = { ...state.player, is_playing: true, progress_ms: 70_000, shuffle_state: false, repeat_state: "off" };
    });

    test("no lyrics: the search fallback picks the closest duration with words, an unknown track is No lyrics with the lrclib action; nothing playing and no device are one line each", async () => {
      state.player = { ...state.player, item: NUDE, progress_ms: 10_000 };
      // Past the optimistic hold of the last key (HOLD_MS), so the reads below are the API's.
      await Bun.sleep(1300);
      const v = await pick("now-playing", "now", "retry");
      const col = find(v.view!.tree, (n: any) => n.key === "lyrics-plain");
      expect(col).toBeTruthy();
      expect(texts(col)).toContain("Don't get any big ideas");
      state.player = { ...state.player, item: BLUE, progress_ms: 10_000 };
      const none = await pick("now-playing", "now", "retry");
      expect(texts(none.view!.tree)).toContain("No lyrics on lrclib");
      expect(await pick("now-playing", "now", "lrclib")).toEqual({ open: `${process.env.PAL_LRCLIB}/search?q=New+Order+Blue+Monday` });
      expect(await pick("now-playing", "now", "copy")).toEqual({ copy: "New Order - Blue Monday" });
      state.player = null;
      const nothing = await pick("now-playing", "now", "retry");
      expect(texts(nothing.view!.tree)).toContain("Nothing playing");
      expect(nothing.view!.actions[0]).toMatchObject({ id: "open-app" });
      expect(await pick("now-playing", "now", "open-app")).toEqual({ open: "spotify:" });
      expect(await pick("search", "track:t1")).toMatchObject({ keep: true, toast: { title: "No active device", style: "failure" } });
      state.player = { device: DEVICES[0], shuffle_state: false, repeat_state: "off", progress_ms: 70_000, is_playing: true, item: WEIRD, currently_playing_type: "track", context: { uri: "spotify:album:al1" } };
    });
  });

  describe("the bar item", () => {
    test("the strip shows the lyric line playing, the popover is the compact view, and the render asks to come back at the next line; hidden while paused; the track name without bar_lyrics", async () => {
      await pick("now-playing", "now", "retry");
      const item = await h.render("spotify", "playing", { reason: "show" });
      expect(item).toMatchObject({ icon: "\u{f04c7}", title: "Your eyes", tooltip: "Radiohead - Weird Fishes/ Arpeggi (hornet)", scroll: { up: "next", down: "previous" } });
      expect(item.refresh).toBeGreaterThanOrEqual(1);
      expect(item.refresh).toBeLessThanOrEqual(7);
      const view = (item.menu as { view: any }).view;
      expect(view.title).toBe("Weird Fishes/ Arpeggi · Radiohead");
      expect(find(view.tree, (n: any) => n.type === "image")).toMatchObject({ width: 64, height: 64 });
      expect(lyricLines(view.tree)).toEqual(["The bottom of the sea", "Your eyes", "They turn me", "Why should I stay here?"]);
      // The queue's next two as rows under the state row, each with its 64 px thumb as a data url, the labels next and then, and a hidden skip action per row; the panel's wide view has none.
      const rows = view.tree.children.filter((n: any) => /^queue-\d/.test(n.key ?? ""));
      expect(rows.map((r: any) => [r.action, texts(r)])).toEqual([["skip:0", ["next", "Nude", "Radiohead"]], ["skip:1", ["then", "Reckoner", "Radiohead"]]]);
      expect(rows.map((r: any) => find(r, (n: any) => n.type === "image")?.src)).toEqual([expect.stringMatching(/^data:image\/jpeg;base64,/), expect.stringMatching(/^data:image\/jpeg;base64,/)]);
      expect(view.actions.filter((a: any) => a.id.startsWith("skip:"))).toEqual([{ id: "skip:0", title: "Skip to Nude", hidden: true }, { id: "skip:1", title: "Skip to Reckoner", hidden: true }]);
      expect(calls("GET", "/v1/me/player/queue").length).toBeGreaterThanOrEqual(1);
      const wide = await pick("now-playing", "now", "retry");
      expect((wide as any).view.tree.children.some((n: any) => /^queue-\d/.test(n.key ?? ""))).toBe(false);
      // The queue is cached: a second render within 15 s asks nothing more.
      const before = calls("GET", "/v1/me/player/queue").length;
      await h.render("spotify", "playing", { reason: "update" });
      expect(calls("GET", "/v1/me/player/queue").length).toBe(before);
      // A queue row clicked: as many Nexts as its place (the queue palette's rule), the queue asked again after.
      const nexts = calls("POST", "/v1/me/player/next").length;
      expect(await h.barAction("spotify", "playing", "skip:1")).toEqual({ keep: true });
      expect(calls("POST", "/v1/me/player/next").length).toBe(nexts + 2);
      expect(calls("GET", "/v1/me/player/queue").length).toBeGreaterThan(before);
      state.player = { ...state.player, is_playing: false };
      // Paused: hidden, the glyph with the paused track as its tooltip and the popover offering Play the empty shape for the core's show = always.
      const quiet = await h.render("spotify", "playing", { reason: "media" as never });
      expect(quiet).toMatchObject({ hidden: true, empty: { icon: "\u{f04c7}", tooltip: "Radiohead - Weird Fishes/ Arpeggi, paused" } });
      expect(quiet.empty!.title).toBeUndefined();
      expect((quiet.empty!.menu as { view: any }).view.actions[0]).toMatchObject({ id: "toggle", title: "Play" });
      // bar_show: paused keeps the track on the strip itself, muted, the popover offering Play.
      h.changeSettings("spotify", { settings: { client_id: "client-abc", redirect_port: REDIRECT_PORT, bar_show: "paused" } });
      await Bun.sleep(50);
      const paused = await h.render("spotify", "playing", { reason: "media" as never });
      expect(paused).toMatchObject({ icon: "\u{f04c7}", title: "Weird Fishes/ Arpeggi · Radiohead", color: "muted", tooltip: "Radiohead - Weird Fishes/ Arpeggi, paused", scroll: { up: "next", down: "previous" } });
      expect(paused.empty).toBeUndefined();
      expect((paused.menu as { view: any }).view.actions[0]).toMatchObject({ id: "toggle", title: "Play" });
      const held = state.player;
      state.player = null;
      // No player at all: hidden either way, the glyph and the popover saying nothing plays the empty shape.
      const none = await h.render("spotify", "playing", { reason: "media" as never });
      expect(none).toMatchObject({ hidden: true, empty: { icon: "\u{f04c7}", tooltip: "Nothing playing" } });
      expect(none.empty!.title).toBeUndefined();
      expect(texts((none.empty!.menu as { view: any }).view.tree)).toContain("Nothing playing");
      expect((none.empty!.menu as { view: any }).view.actions[0]).toMatchObject({ id: "open-app" });
      state.player = { ...held, is_playing: true };
      h.changeSettings("spotify", { settings: { client_id: "client-abc", redirect_port: REDIRECT_PORT, bar_lyrics: false } });
      await Bun.sleep(50);
      expect((await h.render("spotify", "playing", { reason: "update" })).title).toBe("Weird Fishes/ Arpeggi · Radiohead");
      h.changeSettings("spotify", { settings: { client_id: "client-abc", redirect_port: REDIRECT_PORT, bar_lyrics: true } });
      await Bun.sleep(50);
    });

    test("the strip owns a timestamped lyric ticker while closed, and a media render resynchronises its next boundary", async () => {
      state.player = { ...state.player, is_playing: true, progress_ms: 68_500 };
      state.advanceFrom = Date.now();
      const before = h.updates("spotify", "playing").length;
      expect((await h.render("spotify", "playing", { reason: "media" as never })).title).toBe("The bottom of the sea");
      const line = await h.nextUpdate("spotify", "playing", (i) => i.title === "Your eyes", 2500);
      expect(h.updates("spotify", "playing").indexOf(line)).toBeGreaterThanOrEqual(before);

      // MediaRemote has a newer position than our local clock: replace the
      // pending deadline, then follow its next LRC timestamp instead.
      state.advanceFrom = undefined;
      state.player = { ...state.player, progress_ms: 75_500 };
      expect((await h.render("spotify", "playing", { reason: "media" as never })).title).toBe("Your eyes");
      await h.nextUpdate("spotify", "playing", (i) => i.title === "They turn me", 1500);

      state.player = { ...state.player, progress_ms: 70_000 };
      await h.render("spotify", "playing", { reason: "media" as never });
    }, 10_000);

    test("the popover: bar/shown starts a 1 Hz push of the view with the position moving, an action answers keep and the state follows at once, and the pushes stop after the window", async () => {
      const t0 = Date.now();
      state.advanceFrom = t0;
      h.barShown("spotify", "playing");
      const first = await h.nextUpdate("spotify", "playing", (i) => !i.hidden, 2500);
      const pos = (i: any) => find((i.menu as { view: any }).view.tree, (n: any) => n.type === "progress").value as number;
      const second = await h.nextUpdate("spotify", "playing", (i) => !i.hidden && pos(i) > pos(first), 2500);
      expect(pos(second) - pos(first)).toBeGreaterThan(0.5 / 318);
      expect(Date.now() - t0).toBeLessThan(3500);
      state.advanceFrom = undefined;
      const r = await h.barAction("spotify", "playing", "toggle");
      expect(r).toEqual({ keep: true });
      expect(calls("PUT", "/v1/me/player/pause").length).toBeGreaterThanOrEqual(3);
      // The optimistic state: the item rendered right after says paused, before the API is asked again.
      state.player = { ...state.player, is_playing: true };
      expect(await h.barAction("spotify", "playing", "queue")).toEqual({ push: { extension: "spotify", palette: "queue" } });
      expect(await h.barAction("spotify", "playing", "copy")).toEqual({ copy: "Your eyes" });
      // Past the window (2.5 s in the test) the interval stops and the item asks for a render instead.
      await Bun.sleep(3200);
      const n = h.updates("spotify", "playing").length;
      await Bun.sleep(1500);
      expect(h.updates("spotify", "playing").length).toBe(n);
      expect(refreshes.filter((x) => x === "playing").length).toBeGreaterThanOrEqual(1);
    }, 15_000);

    test("the panel's lyrics view: view/shown starts a 1 Hz view.update of the wide tree while the position moves, a paused song pushes nothing new, view/hidden stops it; the item's own popover level ends the window", async () => {
      const t0 = Date.now();
      state.advanceFrom = t0;
      h.viewShown("spotify", { palette: "now-playing" }, "now");
      const pos = (u: any) => find(u.spec.tree, (n: any) => n.type === "progress").value as number;
      const first = await h.nextViewUpdate("spotify", { palette: "now-playing" }, () => true, 2500);
      expect(first).toMatchObject({ extension: "spotify", palette: "now-playing", spec: { id: "now", title: "Weird Fishes/ Arpeggi · Radiohead", keys: "actions" } });
      expect(find(first.spec.tree, (n: any) => n.type === "image")).toMatchObject({ width: 208, height: 208 });
      const second = await h.nextViewUpdate("spotify", { palette: "now-playing" }, (u) => pos(u) > pos(first), 2500);
      expect(pos(second) - pos(first)).toBeGreaterThan(0.5 / 318);
      // Paused, the clock stands still: the tree is the one already pushed, so nothing goes.
      state.advanceFrom = undefined;
      state.player = { ...state.player, is_playing: false };
      await h.nextViewUpdate("spotify", { palette: "now-playing" }, (u) => !!find(u.spec.tree, (n: any) => n.type === "badge" && n.text === "paused"), 2500);
      const n = h.viewUpdates("spotify", { palette: "now-playing" }).length;
      await Bun.sleep(1500);
      expect(h.viewUpdates("spotify", { palette: "now-playing" }).length).toBe(n);
      state.player = { ...state.player, is_playing: true };
      h.viewHidden("spotify", { palette: "now-playing" }, "now");
      await Bun.sleep(1500);
      expect(h.viewUpdates("spotify", { palette: "now-playing" }).length).toBe(n);
      // The popover's own level: shown feeds it, hidden ends the window before TICK_WINDOW_MS.
      const before = h.updates("spotify", "playing").length;
      h.viewShown("spotify", { bar: "playing" }, "now", true);
      await h.nextUpdate("spotify", "playing", (i) => !i.hidden, 2500);
      h.viewHidden("spotify", { bar: "playing" }, "now", true);
      await Bun.sleep(1200);
      const after = h.updates("spotify", "playing").length;
      await Bun.sleep(1200);
      expect(h.updates("spotify", "playing").length).toBe(after);
      expect(after - before).toBeLessThanOrEqual(2);
    }, 20_000);
  });

  test("sign out forgets the tokens; listings ask to sign in again", async () => {
    expect(await pick("commands", "signout")).toMatchObject({ keep: true, toast: { title: "Signed out of Spotify" } });
    expect(stored.get("spotify\0auth")).toBeNull();
    expect((await list("playlists", undefined, { refresh: true }))[0].id).toBe("hint:signin");
    expect(await h.render("spotify", "playing", { reason: "show" })).toMatchObject({ hidden: true, empty: { tooltip: "Sign in to Spotify" } });
  });
});
