// Writes app/src/gallery/shots/youtube.json, the store screenshots'
// fixture: the palettes listed through the host harness against the
// Data API mock (host/test/extensions/youtube-mock.ts, a handful of
// public videos; the thumbnails are YouTube's own, fetched by the shot).
// Nothing is the owner's. `bun run extensions/youtube/fixture.ts`, then
// `node app/scripts/shots.mjs youtube`.
import { writeFileSync } from "node:fs";
import { Host, stored } from "../../host/test/harness.ts";
import { startMock, VIDEOS } from "../../host/test/extensions/youtube-mock.ts";

const { server, base } = startMock();
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
  const fixture = {
    palettes: {
      search: { title: search.title, icon: search.icon, input: true, placeholder: search.placeholder, byQuery: { "": trending, lofi } },
      channels: { title: channels.title, icon: channels.icon, input: true, placeholder: channels.placeholder, byQuery: { "": chHints, lofi: ch } },
      later: { title: later.title, icon: later.icon, live: true, placeholder: later.placeholder, items: saved },
      nokey: { title: search.title, icon: search.icon, input: true, placeholder: search.placeholder, byQuery: { "": noKey } },
    },
    shots: {
      "1-search": { palette: "search", keys: ["type:lofi", "wait:600", "down", "cmd+i", "wait:600"] },
      "2-trending": { palette: "search", keys: ["wait:600"] },
      "3-actions": { palette: "search", keys: ["type:lofi", "wait:600", "down", "cmd+k"] },
      "4-channels": { palette: "channels", keys: ["type:lofi", "wait:600"] },
      "5-later": { palette: "later", keys: ["wait:600"] },
      "6-no-key": { palette: "nokey", keys: [] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/youtube.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log("wrote app/src/gallery/shots/youtube.json");
} finally {
  host.kill();
  server.stop(true);
}
