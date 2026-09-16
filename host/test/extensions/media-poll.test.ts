// The media bar item's own poll: with a player playing at the last render
// it looks again every `POLL_MS` and pushes `bar.update` on a change, and
// stops once nothing plays. Its own host, since the poll interval is
// module state and the clock is real: `PAL_MEDIA_POLL_MS` shortens it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MediaPlayer, NowPlaying } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";

const spotify: MediaPlayer = { id: "spotify", name: "Spotify", state: "playing", title: "Blue Monday", artist: "New Order", album: null, artwork: null, url: null, app: null, position: 1, duration: 448 };
let np: NowPlaying = { players: [spotify], system_wide: true };
let asked = 0;
let host: Host;
beforeAll(async () => {
  process.env.PAL_MEDIA_POLL_MS = "100";
  host = await Host.bundled({ core: { "media.now_playing": () => { asked++; return np; } } }).finally(() => delete process.env.PAL_MEDIA_POLL_MS);
});
afterAll(() => host.kill());

describe("media bar poll", () => {
  test("a track change is pushed; the same state is not; nothing playing pushes hidden and stops the poll", async () => {
    expect((await host.render("media", "now-playing")).title).toBe("Blue Monday · New Order");
    await Bun.sleep(350);
    expect(host.updates("media", "now-playing")).toEqual([]);
    expect(asked).toBeGreaterThan(2);
    np = { players: [{ ...spotify, title: "Ceremony" }], system_wide: true };
    expect((await host.nextUpdate("media", "now-playing")).title).toBe("Ceremony · New Order");
    np = { players: [{ ...spotify, title: "Ceremony", state: "paused" }], system_wide: true };
    expect(await host.nextUpdate("media", "now-playing")).toEqual({ hidden: true });
    const n = asked;
    await Bun.sleep(350);
    expect(asked).toBe(n);
    expect(host.updates("media", "now-playing")).toHaveLength(2);
  });
});
