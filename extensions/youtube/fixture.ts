// Writes app/src/gallery/shots/youtube.json, the store screenshots'
// fixture: the palettes listed through the host harness against the
// Data API mock (host/test/extensions/youtube-mock.ts) serving made-up
// channels and videos at the fixed clock. A real video's thumbnail and a
// real channel's avatar are someone's artwork, so the ones the rows point
// at (YouTube's image hosts) are swapped for SVGs drawn here.
// `bun run extensions/youtube/fixture.ts`, then `node app/scripts/shots.mjs youtube`.
import { NOW_S, pinClock, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host, stored } from "../../host/test/harness.ts";
import { startMock, type MockChannel, type MockVideo } from "../../host/test/extensions/youtube-mock.ts";

const H = 3600, D = 86400;
const CHANNELS: MockChannel[] = [
  { id: "UCslowtide0000000000000a", title: "Slow Tide Lofi", subs: 2_400_000, description: "Beats for slow mornings and late nights.", avatar: "fx-slowtide" },
  { id: "UCpaperlantern00000000b", title: "Paper Lantern Lofi", subs: 861_000, description: "Jazzy lofi, a new tape every Friday.", avatar: "fx-lantern" },
];
const VIDEOS: MockVideo[] = [
  { id: "fxSlowTide1", title: "slow tide radio · lofi beats to study and unwind", channel: "Slow Tide Lofi", channelId: CHANNELS[0].id, seconds: 0, views: 0, published: NOW_S - 3 * H, live: true },
  { id: "fxRainyWin2", title: "Rainy Window Lofi · 3 hours of soft beats for deep focus", channel: "Slow Tide Lofi", channelId: CHANNELS[0].id, seconds: 10934, views: 2_140_000, published: NOW_S - 152 * D },
  { id: "fxAutumnTp3", title: "Autumn Tape · a jazzy lofi mix for September evenings", channel: "Paper Lantern Lofi", channelId: CHANNELS[1].id, seconds: 3516, views: 184_220, published: NOW_S - 12 * D },
  { id: "fxHarborCf4", title: "Harbor Café · morning jazz by the sea", channel: "Harbor Café Sessions", channelId: "UCharborcafe00000000000c", seconds: 13393, views: 352_018, published: NOW_S - 23 * D },
  { id: "fxLanternR5", title: "Paper Lantern Radio · jazzy lofi around the clock", channel: "Paper Lantern Lofi", channelId: CHANNELS[1].id, seconds: 0, views: 0, published: NOW_S - 5 * H, live: true },
  { id: "fxOrzoPan6", title: "One-pan lemon orzo in 25 minutes", channel: "Weeknight Kitchen", channelId: "UCweeknightkitchen0000d", seconds: 892, views: 1_210_000, published: NOW_S - 4 * D },
  { id: "fxCoastRd7", title: "Riding the Black Sea coast: 900 km in nine days", channel: "Two Wheels North", channelId: "UCtwowheelsnorth00000e", seconds: 2285, views: 640_512, published: NOW_S - 8 * D },
];

// ---- the pictures -------------------------------------------------------------------------

const uri = (w: number, h: number, body: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`).toString("base64")}`;
const sky = (a: string, b: string) => `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="320" height="180" fill="url(#s)"/>`;
const hills = (c: string, y = 130) => `<path d="M0 ${y}q60-34 120-6t110-10 90 8v58H0z" fill="${c}"/>`;
const rain = [...Array(26)].map((_, i) => `<path d="M${(i * 37) % 300 + 10} ${(i * 53) % 150 + 6}l-4 12" stroke="#cfe0ff66" stroke-width="2" stroke-linecap="round"/>`).join("");
const THUMBS: Record<string, string> = {
  // Night window, a desk lamp and a moon: the channel's live radio.
  fxSlowTide1: uri(320, 180, `${sky("#1d2a55", "#5a4a8c")}<circle cx="236" cy="52" r="22" fill="#f6e7b0"/><rect x="40" y="26" width="120" height="96" rx="6" fill="#0f1733" stroke="#e9d9a6" stroke-width="5"/><path d="M100 26v96M40 74h120" stroke="#e9d9a6" stroke-width="4"/><rect y="138" width="320" height="42" fill="#2c1f3f"/><path d="M200 138l14-40h28l14 40z" fill="#f2b665"/><rect x="224" y="104" width="4" height="34" fill="#f2b665"/>`),
  // Rain on a pane over a city at dusk.
  fxRainyWin2: uri(320, 180, `${sky("#2b3a52", "#6b7f99")}<path d="M0 120h30v-40h24v26h30v-52h22v66h28v-30h36v46h30v-60h26v70h40v-28h54v70H0z" fill="#1c2636"/>${rain}`),
  // Leaves falling on an orange sky.
  fxAutumnTp3: uri(320, 180, `${sky("#f59e4a", "#c2410c")}${hills("#7c2d12")}${[[60, 40], [140, 70], [210, 30], [260, 90], [110, 110]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="11" ry="6" fill="#fde68a" transform="rotate(35 ${x} ${y})"/>`).join("")}<rect x="118" y="126" width="84" height="46" rx="6" fill="#1f2937"/><circle cx="142" cy="149" r="10" fill="#fcd34d"/><circle cx="178" cy="149" r="10" fill="#fcd34d"/>`),
  // A cup on a counter by the sea.
  fxHarborCf4: uri(320, 180, `${sky("#9fd3e6", "#e7f4f7")}<rect y="96" width="320" height="30" fill="#3b82b6"/><rect y="126" width="320" height="54" fill="#8b5e3c"/><path d="M128 92h60l-6 46h-48z" fill="#f8fafc"/><path d="M188 104q18 2 12 18t-16 10" fill="none" stroke="#f8fafc" stroke-width="6"/><path d="M146 84q-6-12 4-22M166 84q-6-12 4-22" stroke="#ffffffcc" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  // Paper lanterns strung across a dark street.
  fxLanternR5: uri(320, 180, `${sky("#24123a", "#4a1d4f")}<path d="M0 40q160 50 320 0" stroke="#3a2a4a" stroke-width="3" fill="none"/>${[40, 100, 160, 220, 280].map((x, i) => `<ellipse cx="${x}" cy="${58 + (i === 2 ? 14 : i % 2 ? 10 : 2)}" rx="18" ry="24" fill="${["#f87171", "#fbbf24", "#fb923c", "#fbbf24", "#f87171"][i]}"/>`).join("")}<rect y="140" width="320" height="40" fill="#1a0f26"/>`),
  // A pan of orzo with lemon, from above.
  fxOrzoPan6: uri(320, 180, `<rect width="320" height="180" fill="#e7dccb"/><circle cx="160" cy="90" r="70" fill="#374151"/><circle cx="160" cy="90" r="60" fill="#f4e3b1"/>${[[140, 70], [180, 80], [150, 110], [175, 105], [128, 95]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="#65a30d"/>`).join("")}<circle cx="190" cy="62" r="13" fill="#facc15" stroke="#fef08a" stroke-width="3"/><rect x="226" y="84" width="84" height="12" rx="6" fill="#1f2937"/>`),
  // A coast road and a rider's silhouette.
  fxCoastRd7: uri(320, 180, `${sky("#fcd9a8", "#7dd3fc")}<rect y="104" width="320" height="76" fill="#0e7490"/>${hills("#166534", 112)}<path d="M0 170q120-40 320-50v60H0z" fill="#57534e"/><circle cx="188" cy="136" r="9" fill="none" stroke="#111" stroke-width="3"/><circle cx="214" cy="133" r="9" fill="none" stroke="#111" stroke-width="3"/><path d="M188 136l12-12 14 9M200 124l-2-12" stroke="#111" stroke-width="3" fill="none"/><circle cx="197" cy="106" r="5" fill="#111"/>`),
};
const AVATARS: Record<string, string> = {
  "fx-slowtide": uri(64, 64, `<rect width="64" height="64" fill="#3b4a8c"/><circle cx="40" cy="24" r="10" fill="#f6e7b0"/><path d="M0 44q16-8 32 0t32 0v20H0z" fill="#a5b4fc"/>`),
  "fx-lantern": uri(64, 64, `<rect width="64" height="64" fill="#4a1d4f"/><ellipse cx="32" cy="34" rx="14" ry="18" fill="#fb923c"/><path d="M24 18h16M24 50h16" stroke="#fde68a" stroke-width="3"/>`),
};
/** YouTube's thumbnail and avatar urls, as the rows and the detail name them, swapped for the drawings above. */
const drawn = <T>(v: T): T => JSON.parse(JSON.stringify(v)
  .replace(/https:\/\/i\.ytimg\.com\/vi\/([\w-]+)\/\w+\.jpg/g, (u, id) => THUMBS[id] ?? u)
  .replace(/https:\/\/yt3\.ggpht\.com\/([\w-]+)=[\w-]+/g, (u, hash) => AVATARS[hash] ?? u));

// ---- the fixture --------------------------------------------------------------------------

pinClock();
const { server, base } = startMock({ videos: VIDEOS, channels: CHANNELS });
process.env.PAL_YOUTUBE_API = base;
stored.clear();
const host = await Host.bundled({ settings: { youtube: { settings: { api_key: "good", region: "tr" } } } });
try {
  const l = host.loaded().find((l) => l.extension === "youtube")!;
  const [search, channels, later] = l.palettes;
  const lofi = await host.list("youtube", "search", "lofi");
  const trending = await host.list("youtube", "search", "");
  await host.pick("youtube", "search", VIDEOS[1].id, "later");
  await host.list("youtube", "search", "jazz");
  await host.pick("youtube", "search", VIDEOS[3].id, "later");
  const saved = await host.list("youtube", "later");
  const ch = await host.list("youtube", "channels", "lofi");
  const chHints = await host.list("youtube", "channels", "");
  host.changeSettings("youtube", { settings: {} });
  const noKey = await host.list("youtube", "search", "");
  const fixture = drawn({
    palettes: {
      search: { title: search.title, icon: search.icon, input: true, placeholder: search.placeholder, byQuery: { "": trending, lofi } },
      channels: { title: channels.title, icon: channels.icon, input: true, placeholder: channels.placeholder, byQuery: { "": chHints, lofi: ch } },
      later: { title: later.title, icon: later.icon, live: true, placeholder: later.placeholder, items: saved },
      nokey: { title: search.title, icon: search.icon, input: true, placeholder: search.placeholder, byQuery: { "": noKey } },
    },
    shots: {
      "1-search": { palette: "search", keys: ["wait:300", "type:lofi", "wait:600", "down", "cmd+i", "wait:600"], caption: "A search for lofi: each video with its channel, length, views and age, and the detail pane with the thumbnail" },
      "2-trending": { palette: "search", keys: ["wait:600"], caption: "With nothing typed, the videos trending in your region" },
      "3-actions": { palette: "search", keys: ["wait:300", "type:lofi", "wait:600", "down", "cmd+k"], caption: "Open it, play it in your own player, copy the link, keep it for later or go to the channel" },
      "4-channels": { palette: "channels", keys: ["wait:300", "type:lofi", "wait:600"], caption: "Channels by name, each with its avatar and what it is about; Enter lists a channel's latest videos" },
      "5-later": { palette: "later", keys: ["wait:600"], caption: "Watch Later: the videos cmd+S kept, on this Mac and no account needed" },
      "6-no-key": { palette: "nokey", keys: [], caption: "Before it is set up: the one setting to fill, a free API key or an Invidious instance" },
    },
  });
  writeFixture("youtube", await settle(fixture, { hosts: { [base]: "https://www.googleapis.com/youtube/v3" } }));
  console.log("wrote app/src/gallery/shots/youtube.json");
} finally {
  host.kill();
  server.stop(true);
}
