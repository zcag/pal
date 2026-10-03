// A stand-in Apple TV for the tests: `PAL_APPLETV_FAKE=<dir>` swaps the
// real driver for this one. The TV's whole state is `<dir>/tv.json`
// (FakeTv below), read on every call, so a test changes the TV by
// writing the file; a write is also noticed (`fs.watch`) and told to the
// open connection as a change, the way the real TV pushes its events.
// Every command lands as one JSON line in `<dir>/log`, which is what the
// tests read back. Pairing takes the PIN in `pin`; any other is refused
// with the real driver's words.
import { appendFileSync, readFileSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Account, App, ChangeEvent, Conn, Credentials, Driver, Found, Keyboard, Lyrics, MediaCommand, NowPlaying, Paired, Power, QueueItem } from "./types.ts";

export type FakeTv = {
  found: Found[];
  pin: string;
  /** Pairing over this protocol never shows a code (an Apple TV set to refuse it). */
  refuse?: "companion" | "airplay";
  /** connect() fails with this message. */
  down?: string;
  power: Power;
  volume?: number;
  apps: App[];
  accounts: Account[];
  now?: NowPlaying;
  keyboard: Keyboard;
  /** App Store icon urls by bundle id (`tv:<id>` for the 5:3 tvOS one). */
  icons?: Record<string, string>;
  /** What plays next (no artwork in a file). */
  queue?: Omit<QueueItem, "artwork">[];
  lyrics?: Lyrics;
};

const creds = (who: string): Credentials => ({ clientId: `client-${who}`, clientLTSK: "11".repeat(32), clientLTPK: "22".repeat(32), serverLTPK: "33".repeat(32), serverId: who });

export function fakeDriver(dir: string): Driver {
  const file = join(dir, "tv.json");
  const read = (): FakeTv => JSON.parse(readFileSync(file, "utf8"));
  const write = (f: (tv: FakeTv) => void) => { const tv = read(); f(tv); writeFileSync(file, JSON.stringify(tv)); };
  const log = (entry: Record<string, unknown>) => appendFileSync(join(dir, "log"), `${JSON.stringify(entry)}\n`);

  return {
    async scan() { log({ op: "scan" }); return read().found; },
    async pair(found, protocol) {
      log({ op: "pair", id: found.id, protocol });
      if (read().refuse === protocol) throw new Error(`${found.name} did not show a code`);
      let open = true;
      return {
        async finish(pin) {
          log({ op: "pin", protocol, pin });
          if (!open) throw new Error("The pairing was cancelled");
          if (pin.trim() !== read().pin) throw new Error("That code did not match. The TV shows a new one");
          open = false;
          return creds(`${found.id}-${protocol}`);
        },
        cancel() { open = false; log({ op: "cancel", protocol }); },
      };
    },
    async connect(device: Paired): Promise<Conn> {
      const tv0 = read();
      log({ op: "connect", id: device.id });
      if (tv0.down) throw new Error(tv0.down);
      const listeners = new Set<(e: ChangeEvent) => void>();
      const emit = (e: ChangeEvent) => { for (const l of listeners) l(e); };
      // Each write of tv.json is the TV telling its state: now playing, power, volume and the keyboard all said.
      const watcher = watch(file, () => { for (const kind of ["now_playing", "power", "volume", "keyboard"] as const) emit({ kind }); });
      const did = (op: string, extra: Record<string, unknown> = {}) => log({ op, ...extra });
      const conn: Conn = {
        device,
        companionUp: true,
        get mrpUp() { return !!device.airplay; },
        async key(key, press = "tap") {
          did("key", { key, press });
          if (key === "wake") write((tv) => { tv.power = "on"; });
          if (key === "sleep") write((tv) => { tv.power = "off"; });
        },
        async swipe(direction) { did("swipe", { direction }); },
        async touch(x, y) { did("touch", { x, y }); },
        async media(command: MediaCommand, arg?: number) { did("media", { command, ...(arg !== undefined && { arg }) }); },
        nowPlaying: () => (device.airplay ? read().now : undefined),
        async artwork() { return null; },
        async queue(count) { return device.airplay ? (read().queue ?? []).slice(0, count) : []; },
        async playQueueItem(id) { did("queue", { play: id }); },
        async lyrics() { return device.airplay ? read().lyrics ?? null : null; },
        async setLanguage(kind, id) { did("language", { kind, id }); },
        async setRate(rate) { did("rate", { rate }); },
        power: () => read().power,
        async turnOn() { did("power", { to: "on" }); write((tv) => { tv.power = "on"; }); },
        async turnOff() { did("power", { to: "off" }); write((tv) => { tv.power = "off"; }); },
        volume: () => read().volume,
        async setVolume(level) { did("volume", { level }); write((tv) => { tv.volume = level; }); },
        async apps() { return read().apps; },
        async launch(id) { did("launch", { id }); },
        async accounts() { return read().accounts; },
        async switchAccount(id) { did("account", { id }); write((tv) => { tv.accounts = tv.accounts.map((a) => ({ ...a, current: a.id === id })); }); },
        keyboard: () => read().keyboard,
        async setText(text) { did("text", { set: text }); write((tv) => { tv.keyboard.text = text; }); },
        async appendText(text) { did("text", { append: text }); write((tv) => { tv.keyboard.text = (tv.keyboard.text ?? "") + text; }); },
        async clearText() { did("text", { clear: true }); write((tv) => { tv.keyboard.text = ""; }); },
        on(l) { listeners.add(l); return () => listeners.delete(l); },
        async close() { watcher.close(); listeners.clear(); did("close"); },
      };
      return conn;
    },
    async appIcon(bundleId, kind) { return read().icons?.[kind === "tv" ? `tv:${bundleId}` : bundleId]; },
  };
}
