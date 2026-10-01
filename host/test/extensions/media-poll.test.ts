// The media bar item's own poll: with a player playing at the last render
// it looks again every `POLL_MS` (5 s, extensions/media/index.ts) and
// pushes `bar.update` on a change, and stops once nothing plays. Its own
// host, since the poll interval is module state.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MediaPlayer, NowPlaying } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";

/** The extension's POLL_MS. */
const POLL_MS = 5000;
const spotify: MediaPlayer = { id: "spotify", name: "Spotify", state: "playing", title: "Blue Monday", artist: "New Order", album: null, artwork: null, url: null, app: null, position: 1, duration: 448 };
let np: NowPlaying = { players: [spotify], system_wide: true };
let asked = 0;
let host: Host;
beforeAll(async () => {
  host = await Host.bundled({ core: { "media.now_playing": () => { asked++; return np; } } });
});
afterAll(() => host.kill());

describe("media bar poll", () => {
  test("a track change is pushed; the same state is not; a pause is pushed and polled on; no player pushes hidden and stops the poll", async () => {
    expect((await host.render("media", "now-playing")).title).toBe("Blue Monday · New Order");
    const n0 = asked;
    // Nothing until the poll is due; then one look per POLL_MS, the same state pushing nothing.
    await host.advance(POLL_MS - 1);
    await Bun.sleep(30);
    expect(asked).toBe(n0);
    await host.advance(1);
    await host.until(() => asked === n0 + 1);
    await host.advance(POLL_MS);
    await host.until(() => asked === n0 + 2);
    await Bun.sleep(30);
    expect(host.updates("media", "now-playing")).toEqual([]);
    np = { players: [{ ...spotify, title: "Ceremony" }], system_wide: true };
    let u = host.nextUpdate("media", "now-playing");
    await host.advance(POLL_MS);
    expect((await u).title).toBe("Ceremony · New Order");
    // Paused: the same player is still the strip's (the manifest's rule hides it), pushed with playing false, and the poll goes on.
    np = { players: [{ ...spotify, title: "Ceremony", state: "paused" }], system_wide: true };
    u = host.nextUpdate("media", "now-playing");
    await host.advance(POLL_MS);
    expect(await u).toMatchObject({ title: "Ceremony · New Order", states: { playing: false, state: "paused" } });
    // No player at all: hidden with the empty shape, and the poll stops.
    np = { players: [], system_wide: true };
    u = host.nextUpdate("media", "now-playing");
    await host.advance(POLL_MS);
    expect(await u).toMatchObject({ hidden: true, empty: { tooltip: "Nothing playing" } });
    const n = asked;
    await host.advance(3 * POLL_MS);
    await Bun.sleep(30);
    expect(asked).toBe(n);
    expect(host.updates("media", "now-playing")).toHaveLength(3);
  });
});
