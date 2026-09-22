// theater against a mock of the whole stack (theater-mock.ts): the
// Theater palette's health rows and Set up rows, every service's
// palettes (rows, sections, actions, the writes each pick makes), the
// four bar items with their popovers and keys, the links, and the hint
// rows for a missing setting, a refused key and a service that does not
// answer.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkView } from "../../../sdk/src/index.ts";
import type { Form, View, ViewNode } from "../../../sdk/src/protocol.ts";
import { Host, stored } from "../harness.ts";
import { BASE, JF_USER, SETTINGS, calls, seen, server, state } from "./theater-mock.ts";

let host: Host;
beforeAll(async () => {
  stored.clear();
  for (const k of Object.keys(process.env)) if (k.startsWith("PAL_THEATER_")) delete process.env[k];
  process.env.PAL_NOW = "2026-09-16T10:30:00";
  process.env.TZ = "UTC";
  host = await Host.bundled({ settings: { theater: { settings: SETTINGS } }, timeout: 15_000 });
});
afterAll(() => { host.kill(); server.stop(true); });

const list = (palette: string, query?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("theater", palette, query, ctx);
const pick = (palette: string, id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("theater", palette, id, action, ctx);
const ids = (items: { id: string }[]) => items.map((i) => i.id);
const texts = (n: ViewNode): string[] => (n.type === "text" ? [n.value] : n.type === "stack" ? n.children.flatMap(texts) : n.type === "badge" ? [`[${n.text}]`] : []);
const nodes = (n: ViewNode, type: string): ViewNode[] => [...(n.type === type ? [n] : []), ...(n.type === "stack" ? n.children.flatMap((c) => nodes(c, type)) : [])];
const viewOf = (x: unknown): View => { const o = x as { view?: View; menu?: { view?: View }; empty?: { menu?: { view?: View } } }; const v = o.view ?? o.menu?.view ?? o.empty?.menu?.view; if (!v) throw new Error("no view"); return v; };

describe("theater", () => {
  test("meta: 33 palettes (the searches input, the home palettes live, wanted and history indexed), four bar items, seven links, 35 settings, no warnings", () => {
    const l = host.loaded().find((x) => x.extension === "theater")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes).toHaveLength(33);
    expect(l.palettes.filter((p) => p.input).map((p) => p.name)).toEqual(["jellyfin-search", "seerr-request", "radarr-add", "sonarr-add", "lidarr-add", "prowlarr-search", "hydra-search", "navidrome-search", "abs-search", "kavita-search", "shelfmark"]);
    expect(l.palettes.filter((p) => p.live).map((p) => p.name)).toEqual(["theater", "jellyfin", "jellyfin-playing", "seerr-requests", "radarr", "sonarr", "lidarr", "downloads", "navidrome", "abs", "kavita"]);
    expect(l.palettes.find((p) => p.name === "radarr-wanted")!.ttl).toBe(300);
    expect(l.bar.map((b) => [b.id, b.source, b.refresh?.every])).toEqual([["downloads", true, 15], ["playing", true, 30], ["requests", true, 300], ["queue", true, 60]]);
    expect(Object.keys(l.manifest.links!)).toEqual(["search", "request", "downloads", "pause-all", "resume-all", "sync-watchlist", "open"]);
    expect(l.manifest.settings).toHaveLength(35);
    expect(l.manifest.settings!.filter((s) => s.kind === "secret").map((s) => s.id)).toEqual(["jellyfin_key", "seerr_key", "radarr_key", "sonarr_key", "lidarr_key", "prowlarr_key", "hydra_key", "bazarr_key", "sab_key", "qbit_key", "qbit_password", "navidrome_password", "abs_password", "kavita_password"]);
  });

  describe("the Theater palette", () => {
    test("every configured service as a row with its health, version and key number; attention where a queue is stuck or a provider throttled", async () => {
      const rows = await list("theater");
      expect(ids(rows)).toEqual(["service:jellyfin", "service:seerr", "service:radarr", "service:sonarr", "service:lidarr", "service:prowlarr", "service:hydra", "service:bazarr", "service:sab", "service:qbit", "service:navidrome", "service:abs", "service:kavita", "service:shelfmark", "service:filebrowser", "service:homepage"]);
      const by = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(by["service:jellyfin"]).toMatchObject({ subtitle: "v10.11.11 · 1 watching", accessories: [{ tag: "up", color: "green" }], section: "Services" });
      expect(by["service:seerr"]!.subtitle).toBe("v2.7.3 · 1 pending");
      expect(by["service:sonarr"]).toMatchObject({ subtitle: "v4.0.17 · 1 in queue, 1 stuck · 1 health warning", accessories: [{ tag: "attention", color: "amber" }] });
      expect(by["service:radarr"]!.subtitle).toBe("v6.1.1 · 1 in queue");
      expect(by["service:prowlarr"]).toMatchObject({ subtitle: "v2.3.5 · 2 indexers · 1 failing", accessories: [{ tag: "attention", color: "amber" }] });
      expect(by["service:sab"]!.subtitle).toBe("v5.0.3 · 4.4 MB/s, 2 queued · 259.6 G free");
      expect(by["service:qbit"]!.subtitle).toBe("v5.2.1 · 2 downloading · 1.2 MB/s");
      expect(by["service:bazarr"]).toMatchObject({ subtitle: "v1.5.6 · 51 want subtitles · 1 provider throttled", accessories: [{ tag: "attention", color: "amber" }] });
      expect(by["service:navidrome"]!.subtitle).toBe("v0.61.2 · 1 listening");
      expect(by["service:kavita"]!.subtitle).toBe("v0.9.0.2 · 1 on deck");
      expect(by["service:shelfmark"]).toMatchObject({ subtitle: "1 downloading · 1 failed", accessories: [{ tag: "attention", color: "amber" }] });
      expect(by["service:homepage"]).toMatchObject({ subtitle: "up", accessories: [{ tag: "up", color: "green" }] });
      expect(by["service:jellyfin"]!.actions!.map((a) => a.id)).toEqual(["open", "palette:jellyfin", "palette:jellyfin-search", "palette:jellyfin-playing", "copy"]);
      expect(by["service:homepage"]!.actions!.map((a) => a.id)).toEqual(["open", "copy"]);
    });

    test("Enter opens the web UI, cmd+Enter pushes the palette, a drill-in action pushes its own, cmd+c copies the URL", async () => {
      expect(await pick("theater", "service:jellyfin")).toEqual({ open: `${BASE}/jellyfin` });
      expect(await pick("theater", "service:jellyfin", "palette:jellyfin")).toEqual({ push: { extension: "theater", palette: "jellyfin" } });
      expect(await pick("theater", "service:radarr", "palette:radarr-wanted")).toEqual({ push: { extension: "theater", palette: "radarr-wanted" } });
      expect(await pick("theater", "service:sab", "copy")).toEqual({ copy: `${BASE}/sab` });
    });

    test("a service that is down is a red row naming the error; one that rejects the key too", async () => {
      state.down.add("radarr");
      try {
        const r = (await list("theater", undefined, { refresh: true })).find((x) => x.id === "service:radarr")!;
        expect(r.accessories).toEqual([{ tag: "down", color: "red" }]);
        expect(r.subtitle).toMatch(/^Down: /);
      } finally { state.down.delete("radarr"); }
    });

    test("a service without its settings is one Set up row whose Enter opens Settings on its first empty field", async () => {
      host.changeSettings("theater", { settings: { ...SETTINGS, kavita_url: "", abs_password: "" } });
      try {
        const rows = await list("theater", undefined, { refresh: true });
        const setup = rows.filter((r) => r.section === "Set up");
        expect(ids(setup)).toEqual(["hint:setup:abs", "hint:setup:kavita"]);
        expect(setup[0]!.subtitle).toBe("Its user and password under Settings › Extensions › Theater");
        expect(await pick("theater", "hint:setup:kavita")).toEqual({ open: "pal://settings/extensions?anchor=extensions:theater:kavita_url" });
        expect(await pick("theater", "hint:setup:abs")).toEqual({ open: "pal://settings/extensions?anchor=extensions:theater:abs_user" });
        // The unconfigured service's own palettes list nothing at the root; its input palette says what to set.
        expect(await list("kavita")).toEqual([]);
        expect(ids(await list("kavita-search", "ruby"))).toEqual(["hint:setup:kavita"]);
      } finally { host.changeSettings("theater", { settings: SETTINGS }); }
    });

    test("nothing set up at all: one hint that opens Settings", async () => {
      host.changeSettings("theater", { settings: Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, ""])) });
      try {
        const rows = await list("theater", undefined, { refresh: true });
        expect(rows[0]).toMatchObject({ id: "hint:none", name: "Nothing set up yet" });
        expect(rows.filter((r) => r.section === "Set up")).toHaveLength(16);
        expect(await pick("theater", "hint:none")).toEqual({ open: "pal://settings/extensions?anchor=extensions:theater:jellyfin_url" });
        for (const id of ["downloads", "playing", "requests", "queue"]) expect(await host.render("theater", id)).toEqual({ hidden: true });
      } finally { host.changeSettings("theater", { settings: SETTINGS }); }
    });
  });

  describe("jellyfin", () => {
    test("Continue Watching then Latest, an episode led by its series, the position, a favourite and the rating as accessories, the poster as the icon", async () => {
      const rows = await list("jellyfin");
      expect(ids(rows)).toEqual(["item:aaa1", "item:bbb2", "item:ccc3"]);
      expect(rows.map((r) => r.section)).toEqual(["Continue Watching", "Continue Watching", "Latest"]);
      expect(rows[0]).toMatchObject({ name: "Snatch", subtitle: "Movie · 2000 · 1 h 43 min", accessories: [{ text: "7%" }, { text: "★ 7.8" }], icon: { image: `${BASE}/jellyfin/Items/aaa1/Images/Primary?fillHeight=60&fillWidth=40&quality=85&tag=t1` } });
      expect(rows[1]).toMatchObject({ name: "Barry S1E4 · Chapter Four: Commit ... to YOU", subtitle: "Episode · 30 min", accessories: [{ text: "50%" }, { tag: "favourite", color: "pink" }, { text: "★ 7.3" }], icon: { image: `${BASE}/jellyfin/Items/ser1/Images/Primary?fillHeight=60&fillWidth=40&quality=85` } });
      expect(rows[2].accessories).toEqual([{ text: "4 unplayed" }, { text: "★ 8.3" }, { date: "2026-09-10T10:00:00Z" }]);
      expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "play", "played", "favourite", "copy"]);
      // The user setting picked cagdas, not the first user.
      expect(calls("GET", "/jellyfin/UserItems/Resume")[0]!.path).toContain(`userId=${JF_USER}`);
    });

    test("search: sectioned by type, a played movie tagged; the pane has the overview, runtime, rating, genres and watched state", async () => {
      const rows = await list("jellyfin-search", "totoro");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "item:ddd4", section: "Movies", accessories: [{ tag: "played", color: "green" }, { text: "★ 8.1" }] });
      const d = await host.detail("theater", "jellyfin-search", "item:ddd4");
      expect(d.markdown).toContain("![poster](");
      expect(d.markdown).toContain("Two sisters");
      expect(d.metadata!.map((m) => [m.label, m.value])).toEqual([["Type", "Movie"], ["Year", "1988"], ["Runtime", "1 h 26 min"], ["Rating", "★ 8.1"], ["Genres", "Animation"], ["Watched", "Yes, 15 h ago"], ["Added", "4 mo ago"], ["Jellyfin", undefined]]);
      expect(ids(await list("jellyfin-search", "zzz"))).toEqual(["hint:none"]);
      expect(await pick("jellyfin-search", "hint:none", "request")).toEqual({ push: { extension: "theater", palette: "seerr-request" } });
      expect(ids(await list("jellyfin-search", "t"))).toEqual(["hint:search"]);
    });

    test("actions: open, copy, mark played (POST) and unplayed (DELETE), favourite, play pushes the device picker whose Enter plays there", async () => {
      expect(await pick("jellyfin", "item:aaa1")).toEqual({ open: `${BASE}/jellyfin/web/#/details?id=aaa1` });
      expect(await pick("jellyfin", "item:aaa1", "copy")).toEqual({ copy: `${BASE}/jellyfin/web/#/details?id=aaa1` });
      expect(await pick("jellyfin", "item:aaa1", "played")).toMatchObject({ keep: true, toast: { title: "Marked played", message: "Snatch" } });
      expect(calls("POST", "/jellyfin/UserPlayedItems/aaa1")).toHaveLength(1);
      expect(await pick("jellyfin", "item:aaa1", "played")).toMatchObject({ toast: { title: "Marked unplayed" } });
      expect(calls("DELETE", "/jellyfin/UserPlayedItems/aaa1")).toHaveLength(1);
      expect(await pick("jellyfin", "item:bbb2", "favourite")).toMatchObject({ toast: { title: "Removed from favourites" } });
      expect(calls("DELETE", "/jellyfin/UserFavoriteItems/bbb2")).toHaveLength(1);
      expect(await pick("jellyfin", "item:aaa1", "play")).toEqual({ push: { extension: "theater", palette: "jellyfin-play", args: { item: "aaa1", name: "Snatch" }, title: "Play Snatch on" } });
      const devices = await list("jellyfin-play", "", { args: { item: "aaa1", name: "Snatch" } });
      expect(devices.map((d) => [d.id, d.name, d.subtitle])).toEqual([["session:s1", "Living room TV", "Jellyfin Tizen · cagdas · playing Chapter Four: Commit ... to Y…"], ["session:s2", "iPhone", "Swiftfin · guest · active 10 min ago"]]);
      expect(await pick("jellyfin-play", "session:s2", "play", { args: { item: "aaa1" } })).toEqual({ hud: "Playing" });
      expect(calls("POST", "/jellyfin/Sessions/s2/Playing")[0]!.path).toContain("playCommand=PlayNow&itemIds=aaa1");
      expect(await list("jellyfin-play")).toEqual([]);
    });

    test("now playing: the sessions with something on, user and device, the position; pause and stop", async () => {
      const rows = await list("jellyfin-playing");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "session:s1", name: "Barry S1E4 · Chapter Four: Commit ... to YOU", subtitle: "cagdas on Living room TV · Jellyfin Tizen", accessories: [{ tag: "playing", color: "green" }, { text: "50%" }] });
      expect(await pick("jellyfin-playing", "session:s1", "playpause")).toMatchObject({ toast: { title: "Paused" } });
      expect(calls("POST", "/jellyfin/Sessions/s1/Playing/PlayPause")).toHaveLength(1);
      expect(await pick("jellyfin-playing", "session:s1")).toEqual({ open: `${BASE}/jellyfin/web/#/details?id=bbb2` });
    });

    test("a refused key is one hint row that opens Settings", async () => {
      state.unauthorized.add("jellyfin");
      try {
        const rows = await list("jellyfin-search", "snatch");
        expect(rows[0]).toMatchObject({ id: "hint:setup:jellyfin", name: "Jellyfin rejected the key" });
        expect(await pick("jellyfin-search", "hint:setup:jellyfin")).toEqual({ open: "pal://settings/extensions?anchor=extensions:theater:jellyfin_key" });
      } finally { state.unauthorized.delete("jellyfin"); }
    });
  });

  describe("jellyseerr", () => {
    test("requests: pending first with Approve and Decline, the title resolved by tmdb id, the poster, 4K and status tags; the filter narrows", async () => {
      const rows = await list("seerr-requests");
      expect(ids(rows)).toEqual(["req:11", "req:12"]);
      expect(rows[0]).toMatchObject({ name: "Dune (2021)", subtitle: "Movie requested by guest", section: "Pending", icon: { image: "https://image.tmdb.org/t/p/w92/dune.jpg" }, accessories: [{ tag: "pending", color: "amber" }, { date: "2026-09-15T09:00:00Z" }] });
      expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "approve", "decline", "copy"]);
      expect(rows[1]).toMatchObject({ name: "Dune: Prophecy (2024)", subtitle: "Series requested by cagdas · 1 season", section: "Earlier", accessories: [{ tag: "4K", color: "violet" }, { tag: "approved", color: "blue" }, { tag: "processing", color: "blue" }, { date: "2026-09-10T09:00:00Z" }] });
      expect(rows[1].actions!.map((a) => a.id)).toEqual(["open", "copy"]);
      expect(ids(await list("seerr-requests", undefined, { filter: "approved" }))).toEqual(["req:12"]);
      expect(await pick("seerr-requests", "req:11")).toEqual({ open: `${BASE}/seerr/movie/438631` });
      expect(await pick("seerr-requests", "req:11", "approve")).toMatchObject({ toast: { title: "Approved", message: "Dune" } });
      expect(calls("POST", "/seerr/api/v1/request/11/approve")).toHaveLength(1);
      expect(await pick("seerr-requests", "req:11", "decline")).toMatchObject({ toast: { title: "Declined" } });
    });

    test("request a title: TMDB hits without people, a requested one tagged, Enter requests, cmd+Enter in 4K when the server allows it (movies here)", async () => {
      const rows = await list("seerr-request", "dune");
      expect(ids(rows)).toEqual(["result:movie:438631", "result:movie:693134"]);
      expect(rows[0]).toMatchObject({ name: "Dune (2021)", section: "Movies", accessories: [{ tag: "requested", color: "amber" }, { text: "★ 7.8" }] });
      expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "request", "request4k", "tmdb"]);
      expect(rows[1].actions!.map((a) => [a.id, !!a.confirm])).toEqual([["request", true], ["request4k", true], ["open", false], ["tmdb", false]]);
      expect(await pick("seerr-request", "result:movie:693134", "request")).toEqual({ hud: "Requested Dune: Part Two" });
      expect(calls("POST", "/seerr/api/v1/request").at(-1)!.body).toEqual({ mediaType: "movie", mediaId: 693134, is4k: false });
      expect(await pick("seerr-request", "result:movie:693134", "request4k")).toEqual({ hud: "Requested Dune: Part Two in 4K" });
      expect(calls("POST", "/seerr/api/v1/request").at(-1)!.body).toMatchObject({ is4k: true });
      expect(await pick("seerr-request", "result:movie:693134", "tmdb")).toEqual({ copy: "https://www.themoviedb.org/movie/693134" });
      expect(ids(await list("seerr-request", "nothing"))).toEqual(["hint:none"]);
    });
  });

  describe("the arrs", () => {
    test("the home palette: commands, health warnings, the queue with state and progress, the next seven days", async () => {
      const rows = await list("sonarr");
      expect(ids(rows)).toEqual(["cmd:sonarr:add", "cmd:sonarr:wanted", "cmd:sonarr:history", "cmd:sonarr:sync", "cmd:sonarr:open", "health:sonarr:UpdateCheck", "queue:sonarr:902", "cal:sonarr:1469"]);
      expect(rows[5]).toMatchObject({ name: "New update is available", section: "Health", accessories: [{ tag: "warning", color: "amber" }], url: "https://wiki/update" });
      expect(rows[6]).toMatchObject({ name: "Ted Lasso S4E1 · Home", subtitle: "Ted.Lasso.S04E01.PROPER.1080p.WEB.h264-ETHEL · Episode file already imported at a higher quality", section: "Queue", accessories: [{ tag: "needs a hand", color: "amber" }, { text: "usenet" }, { text: "2.98 GB" }], icon: { image: "https://img/lasso.jpg" } });
      expect(rows[7]).toMatchObject({ name: "Ted Lasso S4E8 · Follow the Anger", subtitle: "Airs Wed 23 Sep on Apple TV", section: "Next 7 days" });
      const radarr = await list("radarr");
      expect(radarr.find((r) => r.id === "queue:radarr:901")).toMatchObject({ name: "Oppenheimer (2023)", accessories: [{ tag: "downloading", color: "blue" }, { text: "usenet" }, { text: "75%" }, { text: "13 min" }] });
      expect(ids(await list("lidarr"))).toEqual(["cmd:lidarr:add", "cmd:lidarr:wanted", "cmd:lidarr:history", "cmd:lidarr:open", "hint:idle:lidarr"]);
    });

    test("the commands push their palettes; Sync watchlist runs ImportListSync per enabled list; a queue item removes without blocklisting", async () => {
      expect(await pick("sonarr", "cmd:sonarr:add")).toEqual({ push: { extension: "theater", palette: "sonarr-add" } });
      expect(await pick("sonarr", "cmd:sonarr:history")).toEqual({ push: { extension: "theater", palette: "sonarr-history" } });
      expect(await pick("sonarr", "cmd:sonarr:sync")).toMatchObject({ toast: { title: "Syncing", message: "1 import list on Sonarr" } });
      expect(calls("POST", "/sonarr/api/v3/command").map((c) => c.body)).toEqual([{ name: "ImportListSync", definitionId: 1 }]);
      expect(await pick("sonarr", "queue:sonarr:902")).toEqual({ open: `${BASE}/sonarr/series/ted-lasso` });
      expect(await pick("sonarr", "queue:sonarr:902", "remove")).toMatchObject({ toast: { title: "Removed from the queue", message: "Ted Lasso S4E1 · Home" } });
      expect(calls("DELETE", "/sonarr/api/v3/queue/902")[0]!.path).toContain("removeFromClient=true&blocklist=false");
    });

    test("wanted: the newest with a line saying how many more; Enter searches, cmd+Enter opens", async () => {
      const rows = await list("sonarr-wanted");
      expect(ids(rows)).toEqual(["hint:more:sonarr", "wanted:sonarr:2054"]);
      expect(rows[0].name).toBe("54 wanted, the newest 1 here");
      expect(rows[1]).toMatchObject({ name: "Patriot S1E5 · Un Monsieur Triste", subtitle: "Aired Thu 23 Feb 2017", url: `${BASE}/sonarr/series/patriot` });
      expect(await pick("sonarr-wanted", "wanted:sonarr:2054", "search")).toMatchObject({ toast: { title: "Searching" } });
      expect(calls("POST", "/sonarr/api/v3/command").at(-1)!.body).toEqual({ name: "EpisodeSearch", episodeIds: [2054] });
      expect(await pick("radarr-wanted", "wanted:radarr:5", "search")).toMatchObject({ toast: { title: "Searching" } });
      expect(calls("POST", "/radarr/api/v3/command").at(-1)!.body).toEqual({ name: "MoviesSearch", movieIds: [5] });
      expect(ids(await list("lidarr-wanted"))).toEqual(["hint:none:lidarr"]);
    });

    test("history: imported and failed events with the release, quality and reason", async () => {
      const rows = await list("sonarr-history");
      expect(rows.map((r) => [r.id, r.name, r.accessories![0]])).toEqual([["history:sonarr:4893", "Barry S2E7 · The Audition", { tag: "imported", color: "green" }], ["history:sonarr:4888", "Barry", { tag: "failed", color: "red" }]]);
      expect(rows[1].subtitle).toBe("Barry.S02E03.1080p.WEB · Aborted, cannot be completed");
      expect(rows[0].url).toBe(`${BASE}/sonarr/series/barry`);
    });

    test("add: a lookup with one in the library tagged; Enter adds with the first profile and root folder and searches, cmd+Enter without", async () => {
      const rows = await list("radarr-add", "oppenheimer");
      expect(rows.map((r) => [r.id, r.name, r.accessories])).toEqual([["hit:radarr:872585", "Oppenheimer (2023)", [{ tag: "in library", color: "green" }]], ["hit:radarr:1143770", "Oppenheimer After Trinity (2023)", []]]);
      expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "ext"]);
      expect(rows[1].actions!.map((a) => [a.id, !!a.confirm])).toEqual([["add", true], ["add-quiet", true], ["ext", false]]);
      expect(await pick("radarr-add", "hit:radarr:1143770", "add")).toEqual({ hud: "Added Oppenheimer After Trinity to Radarr" });
      expect(calls("POST", "/radarr/api/v3/movie").at(-1)!.body).toEqual({ qualityProfileId: 7, rootFolderPath: "/data/library/radarr", monitored: true, title: "Oppenheimer After Trinity", tmdbId: 1143770, year: 2023, minimumAvailability: "released", addOptions: { searchForMovie: true } });
      expect(await pick("radarr-add", "hit:radarr:872585", "open")).toEqual({ open: `${BASE}/radarr/movie/872585` });
      const series = await list("sonarr-add", "ted lasso");
      expect(series[0]).toMatchObject({ id: "hit:sonarr:383203", subtitle: "Apple TV · continuing", accessories: [{ tag: "in library", color: "green" }] });
      const artists = await list("lidarr-add", "snarky");
      expect(await pick("lidarr-add", "hit:lidarr:feb1c651", "add-quiet")).toEqual({ hud: "Added Snarky Anarchy to Lidarr" });
      expect(calls("POST", "/lidarr/api/v1/artist").at(-1)!.body).toMatchObject({ artistName: "Snarky Anarchy", metadataProfileId: 1, addOptions: { searchForMissingAlbums: false, monitor: "all" } });
      expect(artists[0].accessories).toEqual([{ tag: "in library", color: "green" }]);
      expect(ids(await list("radarr-add", "x"))).toEqual(["hint:lookup:radarr"]);
    });
  });

  describe("downloads", () => {
    test("one queue over both clients: the commands, the active first, state, progress, speed and time left; a done torrent is history", async () => {
      const rows = await list("downloads");
      expect(ids(rows)).toEqual(["cmd:toggle", "cmd:limit", "dl:sab:SABnzbd_nzo_1", "dl:qbit:f7e9", "dl:sab:SABnzbd_nzo_2", "dl:qbit:a1b2"]);
      expect(rows[2]).toMatchObject({ name: "Oppenheimer.2023.1080p.WEB-DL", subtitle: "movies · 4.4 MB/s · 13 min left · 7.45 GB", section: "SABnzbd", accessories: [{ tag: "downloading", color: "blue" }, { text: "75%" }] });
      expect(rows[3]).toMatchObject({ name: "ted.lasso.s04e04.1080p.web.h264-cakes", subtitle: "tv-sonarr · 1.2 MB/s · 15 min left · 3.31 GB", section: "qBittorrent", accessories: [{ tag: "downloading", color: "blue" }, { text: "42%" }] });
      expect(rows[5]).toMatchObject({ accessories: [{ tag: "stalled", color: "amber" }, { text: "0%" }] });
      expect(rows[2].actions!.map((a) => a.id)).toEqual(["open", "pause", "delete", "copy"]);
      // qBittorrent signed in with the user and password (the mock refuses a login without a Referer), once per settings change.
      expect(calls("POST", "/qbit/api/v2/auth/login").length).toBeGreaterThanOrEqual(1);
    });

    test("pause and resume an item on either client (stop/start on qBittorrent 5), delete, pause all and resume all", async () => {
      expect(await pick("downloads", "dl:sab:SABnzbd_nzo_1", "pause")).toMatchObject({ toast: { title: "Paused" } });
      expect(calls("GET", "/sab/api").at(-1)!.path).toContain("mode=queue&name=pause&value=SABnzbd_nzo_1");
      expect(await pick("downloads", "dl:qbit:f7e9", "pause")).toMatchObject({ toast: { title: "Paused" } });
      expect(calls("POST", "/qbit/api/v2/torrents/stop").at(-1)!.body).toBe("hashes=f7e9");
      expect(await pick("downloads", "dl:qbit:f7e9", "delete")).toMatchObject({ toast: { title: "Deleted" } });
      expect(calls("POST", "/qbit/api/v2/torrents/delete").at(-1)!.body).toBe("hashes=f7e9&deleteFiles=true");
      expect(await pick("downloads", "cmd:toggle")).toMatchObject({ toast: { title: "Paused", message: "SABnzbd and qBittorrent" } });
      expect(state.sabPaused).toBe(true);
      expect(calls("POST", "/qbit/api/v2/torrents/stop").at(-1)!.body).toBe("hashes=all");
      const rows = await list("downloads", undefined, { refresh: true });
      expect(rows[0]).toMatchObject({ id: "cmd:toggle", name: "Resume all" });
      expect(await pick("downloads", "cmd:toggle")).toMatchObject({ toast: { title: "Resumed" } });
      expect(state.sabPaused).toBe(false);
    });

    test("the speed limit form: a percentage or a rate for SABnzbd, a rate for qBittorrent, 0 lifts it; a bad value stays in the form", async () => {
      const f = (await pick("downloads", "cmd:limit")).form as Form;
      expect(f.fields.map((x) => x.id)).toEqual(["sab", "qbit"]);
      expect(await pick("downloads", "cmd:limit", "limit:save", { values: { sab: "50", qbit: "2M" } })).toMatchObject({ toast: { title: "Speed limit set", message: "SABnzbd 50, qBittorrent 2M" } });
      expect(calls("GET", "/sab/api").at(-1)!.path).toContain("mode=config&name=speedlimit&value=50");
      expect(calls("POST", "/qbit/api/v2/transfer/setDownloadLimit").at(-1)!.body).toBe("limit=2097152");
      expect(await pick("downloads", "cmd:limit", "limit:save", { values: { sab: "", qbit: "0" } })).toMatchObject({ toast: { message: "qBittorrent unlimited" } });
      expect(((await pick("downloads", "cmd:limit", "limit:save", { values: { sab: "fast", qbit: "" } })).form as Form).errors).toEqual({ sab: "50, 2M, 500K or 0" });
    });

    test("history: completed and failed with the reason from SABnzbd, done torrents from qBittorrent", async () => {
      const rows = await list("downloads-history");
      expect(ids(rows)).toEqual(["hist:sab:SABnzbd_nzo_9", "hist:sab:SABnzbd_nzo_8", "hist:qbit:c3d4"]);
      expect(rows[1]).toMatchObject({ subtitle: "tv · 0 B · Aborted, cannot be completed - https://sabnzbd.org/not-complete", accessories: [{ tag: "failed", color: "red" }, { date: 1787000000000 }] });
      expect(rows[2]).toMatchObject({ name: "Dune.2021.2160p", section: "qBittorrent", subtitle: "movies · 18.63 GB · ratio 0.20" });
      expect(await pick("downloads-history", "hist:sab:SABnzbd_nzo_8", "forget")).toMatchObject({ toast: { title: "Removed" } });
      expect(calls("GET", "/sab/api").at(-1)!.path).toContain("mode=history&name=delete&value=SABnzbd_nzo_8");
    });
  });

  describe("indexers", () => {
    test("Prowlarr's indexers by protocol with health, a failing one red with its reason and retry, a disabled one grey; the health warnings", async () => {
      const rows = await list("prowlarr");
      expect(rows.map((r) => [r.id, r.section, r.accessories![0]])).toEqual([["indexer:3", "Torrent indexers", { tag: expect.stringMatching(/^failing, retry in/), color: "red" }], ["indexer:1", "Usenet indexers", { tag: "ok", color: "green" }], ["indexer:4", "Torrent indexers", { tag: "disabled", color: "grey" }]]);
      expect(rows[0].subtitle).toBe("torrent · public · priority 25 · Unable to access eztvx.to, blocked by CloudFlare");
      expect(await pick("prowlarr", "indexer:3", "test")).toMatchObject({ toast: { title: "Indexer OK" } });
      expect(calls("POST", "/prowlarr/api/v1/indexer/3/test")).toHaveLength(1);
    });

    test("search: releases with size, age, indexer tag and seeders or grabs; Enter grabs through Prowlarr, cmd+c copies the magnet or link", async () => {
      const rows = await list("prowlarr-search", "ubuntu");
      expect(rows.map((r) => [r.name, r.section, r.accessories])).toEqual([["ubuntu-24.04-desktop-amd64", "NZBgeek", [{ tag: "NZBgeek", color: "amber" }, { text: "93 grabs" }]], ["Ubuntu 22.04 LTS", "EZTV", [{ tag: "EZTV", color: "blue" }, { text: "37 seeds" }]]]);
      expect(rows[0].subtitle).toBe("5.40 GB · 7 mo · PC");
      expect(await pick("prowlarr-search", rows[0].id, "grab")).toEqual({ hud: "Grabbed ubuntu-24.04-desktop-amd64" });
      expect(calls("POST", "/prowlarr/api/v1/search").at(-1)!.body).toEqual({ guid: "https://nzbgeek.info/geekseek.php?guid=1", indexerId: 1 });
      expect(await pick("prowlarr-search", rows[1].id, "copy")).toEqual({ copy: "magnet:?xt=urn:btih:ABC" });
      expect(ids(await list("prowlarr-search", "ub"))).toEqual(["hint:search"]);
    });

    test("NZBHydra2: the newznab items; Enter sends the NZB to SABnzbd", async () => {
      const rows = await list("hydra-search", "ubuntu");
      expect(rows[0]).toMatchObject({ id: "nzb:-1572", name: "ubuntu-20.04.3-desktop-amd64", subtitle: "2.29 GB · 4 y ago · PC", section: "NZBGeek", accessories: [{ tag: "NZBGeek", color: "amber" }, { text: "206 grabs" }] });
      expect(rows[0].actions!.map((a) => a.id)).toEqual(["send", "page", "copy"]);
      expect(await pick("hydra-search", "nzb:-1572", "send")).toEqual({ hud: "Sent ubuntu-20.04.3-desktop-amd64 to SABnzbd" });
      expect(calls("GET", "/sab/api").at(-1)!.path).toContain("mode=addurl");
    });
  });

  describe("music and books", () => {
    test("Navidrome: now playing then recently added with covers through a salted token; search by artist, album and song; star", async () => {
      const rows = await list("navidrome");
      expect(rows.map((r) => [r.id, r.section])).toEqual([["song:so1", "Now playing"], ["album:al1", "Recently added"]]);
      expect(rows[0].subtitle).toBe("cagdas · Symfonium · 1 min ago · Snarky Puppy");
      expect((rows[1].icon as { image: string }).image).toMatch(new RegExp(`^${BASE}/navidrome/rest/getCoverArt\\.view\\?id=al-al1&size=60&u=cagdas&t=[0-9a-f]{32}&s=\\w+&v=1\\.16\\.1&c=pal$`));
      const hits = await list("navidrome-search", "snarky");
      expect(hits.map((r) => r.section)).toEqual(["Artists", "Albums", "Songs"]);
      expect(await pick("navidrome-search", "artist:ar1")).toEqual({ open: `${BASE}/navidrome/app/#/artist/ar1/show` });
      expect(await pick("navidrome-search", "song:so1", "star")).toMatchObject({ toast: { title: "Unstarred", message: "Chonks" } });
      expect(calls("GET", "/navidrome/rest/unstar.view")).toHaveLength(1);
      expect(await pick("navidrome-search", "album:al1", "star")).toMatchObject({ toast: { title: "Starred" } });
    });

    test("Audiobookshelf: continue listening with the progress, then what was added; search over books and authors; mark finished", async () => {
      const rows = await list("abs");
      expect(rows.map((r) => [r.id, r.section])).toEqual([["item:it1", "Continue listening"], ["item:it2", "Recently added · Audiobooks"]]);
      expect(rows[0]).toMatchObject({ name: "Project Hail Mary", subtitle: "Andy Weir · 16.1 h · 31%", accessories: [{ text: "31%" }, { date: 1787400000000 }], icon: { image: `${BASE}/abs/api/items/it1/cover?width=60&token=abs-jwt` } });
      expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "finish", "copy"]);
      expect(await pick("abs", "item:it1", "finish")).toMatchObject({ toast: { title: "Marked finished", message: "Project Hail Mary" } });
      expect(calls("PATCH", "/abs/api/me/progress/it1").at(-1)!.body).toEqual({ isFinished: true });
      const hits = await list("abs-search", "mars");
      expect(hits.map((r) => [r.id, r.section])).toEqual([["item:it2", "Audiobooks"], ["author:lib1:au1", "Authors"]]);
      expect(await pick("abs-search", "item:it2")).toEqual({ open: `${BASE}/abs/item/it2` });
    });

    test("Kavita: on deck with the page, then recently added; search over series and files; Enter opens the reader", async () => {
      const rows = await list("kavita");
      expect(rows.map((r) => [r.id, r.section])).toEqual([["series:3", "Continue reading"], ["series:6", "Recently added"]]);
      expect(rows[0]).toMatchObject({ name: "Measure What Matters", subtitle: "Ebooks · epub · page 11 of 73 · ~3 h", accessories: [{ text: "15%" }, { date: "2026-08-29T23:45:43" }], icon: { image: `${BASE}/kavita/api/image/series-cover?seriesId=3&apiKey=kavita-key` } });
      expect(await pick("kavita", "series:3")).toEqual({ open: `${BASE}/kavita/library/1/series/3` });
      const hits = await list("kavita-search", "ruby");
      expect(hits.map((r) => [r.id, r.section])).toEqual([["series:6", "Series"], ["file:7", "Files"]]);
      expect(await pick("kavita-search", "series:6")).toEqual({ open: `${BASE}/kavita/library/1/series/6` });
    });

    test("Shelfmark: with nothing typed the status rows; a search lists books, Enter pushes the releases, Enter on one downloads with the book and release data", async () => {
      const idle = await list("shelfmark", "");
      expect(ids(idle)).toEqual(["hint:search", "status:d1", "status:e1"]);
      expect(idle[1]).toMatchObject({ name: "Project Hail Mary", accessories: [{ tag: "downloading", color: "blue" }, { text: "42%" }] });
      expect(idle[2]).toMatchObject({ subtitle: "stalled, no seeders", accessories: [{ tag: "failed", color: "red" }] });
      const books = await list("shelfmark", "dune");
      expect(books[0]).toMatchObject({ id: "book:hc1", name: "Dune", subtitle: "Frank Herbert · 1965 · Dune #1", icon: { image: "https://img/dune.jpg" } });
      expect(await pick("shelfmark", "book:hc1")).toEqual({ push: { extension: "theater", palette: "shelfmark-releases", args: { book: "hc1" }, title: "Releases for Dune" } });
      const rel = await list("shelfmark-releases", "", { args: { book: "hc1" } });
      expect(rel.map((r) => [r.id, r.subtitle, r.accessories])).toEqual([["release:hc1:0", "EPUB · 1.2 MB · NZBgeek", [{ tag: "prowlarr", color: "amber" }]], ["release:hc1:1", "EPUB · 980 KB · 1337x", [{ tag: "prowlarr", color: "blue" }, { text: "41 seeds" }]]]);
      expect(await pick("shelfmark-releases", "release:hc1:0", "download")).toEqual({ hud: "Downloading Dune" });
      expect(calls("POST", "/shelfmark/api/releases/download").at(-1)!.body).toMatchObject({ book_data: { title: "Dune", author: "Frank Herbert", provider: "hardcover", provider_id: "hc1", content_type: "ebook" }, release_data: { source: "prowlarr", source_id: "r1", format: "epub", indexer: "NZBgeek" }, context: { source: "prowlarr", content_type: "ebook", request_level: "release" } });
      expect(await list("shelfmark-releases")).toEqual([]);
    });

    test("Bazarr: the counts, the providers with a throttled one, the wanted items with their languages; searching runs the tasks", async () => {
      const rows = await list("bazarr");
      expect(ids(rows)).toEqual(["cmd:search", "provider:embeddedsubtitles", "provider:opensubtitlescom", "provider:subf2m", "movie:48", "hint:more-movies", "episode:1970", "hint:more-episodes"]);
      expect(rows[0].name).toBe("2 movies and 49 episodes want subtitles");
      expect(rows[3]).toMatchObject({ subtitle: "Throttled, retry in 11 hours", accessories: [{ tag: "throttled", color: "red" }] });
      expect(rows[4]).toMatchObject({ name: "Sovereign", subtitle: "Wants Turkish · Sovereign.2025.1080p.WEB", accessories: [{ tag: "tr", color: "amber" }] });
      expect(await pick("bazarr", "cmd:search", "search-all")).toMatchObject({ toast: { title: "Searching" } });
      expect(calls("POST", "/bazarr/api/system/tasks").map((c) => c.path)).toEqual(["/bazarr/api/system/tasks?taskid=wanted_search_missing_subtitles_movies", "/bazarr/api/system/tasks?taskid=wanted_search_missing_subtitles_series"]);
      expect(await pick("bazarr", "episode:1970", "search")).toMatchObject({ toast: { title: "Searching" } });
      expect(calls("PATCH", "/bazarr/api/episodes/subtitles")[0]!.path).toContain("sonarrepisodeid=1970");
      expect(await pick("bazarr", "movie:48")).toEqual({ open: `${BASE}/bazarr/movies/48` });
    });
  });

  describe("bar items", () => {
    test("downloads: the speed and the active count, the popover's rows with progress bars, space pauses everything, the arrows move the cursor, Enter opens the client", async () => {
      const item = await host.render("theater", "downloads", { reason: "cli" });
      expect(item).toMatchObject({ title: "5.6 MB/s · 2", states: { downloading: 2, speed: 5603200, paused: false } });
      const v = viewOf(item);
      expect(checkView(v, "test")).toBe(v);
      expect(v.title).toBe("4 downloads");
      expect(texts(v.tree)[0]).toBe("5.6 MB/s · 2 active");
      expect(nodes(v.tree, "progress")).toHaveLength(4);
      expect(v.actions.map((a) => a.id).slice(0, 5)).toEqual(["open", "toggle-all", "toggle", "delete", "open-pal"]);
      expect(nodes(v.tree, "stack").find((n) => n.selected)?.key).toBe("sab:SABnzbd_nzo_1");
      const down = viewOf(await host.barAction("theater", "downloads", "down"));
      expect(nodes(down.tree, "stack").find((n) => n.selected)?.key).toBe("qbit:f7e9");
      expect(await host.barAction("theater", "downloads", "open")).toEqual({ open: `${BASE}/qbit` });
      expect(await host.barAction("theater", "downloads", "toggle-all")).toEqual({ keep: true, hud: "Paused" });
      expect(state.sabPaused).toBe(true);
      const paused = await host.render("theater", "downloads", { reason: "cli" });
      expect(paused).toMatchObject({ title: "paused · 4", tooltip: "4 in the queue, paused", states: { paused: true, speed: 0 } });
      expect(await host.barAction("theater", "downloads", "toggle-all")).toEqual({ keep: true, hud: "Resumed" });
      expect(await host.barAction("theater", "downloads", "open-pal")).toEqual({ push: { extension: "theater", palette: "downloads" } });
    });

    test("playing: who is watching, the popover with the poster and the position, space pauses the focused session", async () => {
      const item = await host.render("theater", "playing", { reason: "cli" });
      expect(item).toMatchObject({ title: "cagdas", tooltip: "cagdas · Chapter Four: Commit ... to YOU on Living room TV", states: { watching: 1 } });
      const v = viewOf(item);
      expect(checkView(v, "test")).toBe(v);
      expect(texts(v.tree)).toContain("Barry S1E4 · Chapter Four: Commit ... to YOU");
      expect(nodes(v.tree, "image")).toHaveLength(1);
      expect(await host.barAction("theater", "playing", "playpause")).toMatchObject({ view: expect.any(Object) });
      expect(calls("POST", "/jellyfin/Sessions/s1/Playing/PlayPause").length).toBeGreaterThanOrEqual(2);
    });

    test("requests: the pending count as the badge, a approves and d declines the focused one", async () => {
      const item = await host.render("theater", "requests", { reason: "cli" });
      expect(item).toMatchObject({ badge: 1, tooltip: "1 pending request", states: { pending: 1 } });
      const v = viewOf(item);
      expect(texts(v.tree)).toContain("Dune (2021)");
      expect(v.actions.filter((a) => !a.hidden).map((a) => [a.id, a.shortcut])).toEqual([["open", undefined], ["approve", "a"], ["decline", "d"], ["open-pal", "p"]]);
      expect(await host.barAction("theater", "requests", "approve")).toEqual({ keep: true, hud: "Approved" });
      expect(calls("POST", "/seerr/api/v1/request/11/approve").length).toBeGreaterThanOrEqual(2);
    });

    test("queue: the arr queues combined, the stuck count as the badge, backspace removes the focused item", async () => {
      const item = await host.render("theater", "queue", { reason: "cli" });
      expect(item).toMatchObject({ title: "2", badge: 1, tooltip: "2 in the queues, 1 needs attention", states: { queued: 2, stuck: 1 } });
      const v = viewOf(item);
      expect(texts(v.tree)[0]).toBe("1 moving, 1 needs attention");
      expect(texts(v.tree)).toContain("Ted Lasso S4E1 · Home");
      expect(await host.barAction("theater", "queue", "remove")).toMatchObject({ view: expect.any(Object) });
      expect(calls("DELETE", "/radarr/api/v3/queue/901")).toHaveLength(1);
    });

    test("each item hides with its empty shape when there is nothing to say", async () => {
      state.idle = true;
      try {
        const item = await host.render("theater", "downloads", { reason: "cli" });
        expect(item).toMatchObject({ hidden: true, states: { downloading: 0, speed: 0 }, empty: { tooltip: "Nothing downloading" } });
        expect(texts(viewOf(item).tree)).toContain("Nothing downloading");
      } finally { state.idle = false; }
    });
  });

  describe("links", () => {
    const link = (route: string, params: Record<string, unknown> = {}) => host.request<unknown>("link", { extension: "theater", route, params });
    test("search and request push their palettes with the query; downloads pushes; pause-all and resume-all reach both clients; sync-watchlist per app; open a service", async () => {
      expect(await link("search", { q: "totoro" })).toEqual({ push: { extension: "theater", palette: "jellyfin-search", query: "totoro" } });
      expect(await link("request", { q: "dune" })).toEqual({ push: { extension: "theater", palette: "seerr-request", query: "dune" } });
      expect(await link("downloads")).toEqual({ push: { extension: "theater", palette: "downloads" } });
      expect(await link("pause-all")).toEqual({ hud: "Paused SABnzbd and qBittorrent" });
      expect(await link("resume-all")).toEqual({ hud: "Resumed SABnzbd and qBittorrent" });
      expect(await link("sync-watchlist", { app: "radarr" })).toEqual({ hud: "Syncing Radarr (1 list)" });
      expect(await link("sync-watchlist")).toEqual({ hud: "Syncing Radarr (1 list), Sonarr (1 list)" });
      expect(await link("open", { service: "kavita" })).toEqual({ open: `${BASE}/kavita` });
      await expect(link("open", { service: "plex" })).rejects.toThrow('no service "plex"');
      expect(seen.length).toBeGreaterThan(0);
    });
  });
});
