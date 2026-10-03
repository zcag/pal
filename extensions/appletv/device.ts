// The real Driver (types.ts): mDNS discovery, pairing (node-appletv-remote's
// pair-setup for Companion and AirPlay, both a PIN on the TV's screen), and
// a live `Conn` over Companion (protocol/session.ts: buttons, touch, apps,
// accounts, power, volume, the text field) plus MRP over AirPlay when that
// is paired too (protocol/mrp.ts: what plays, its cover, seek, shuffle,
// repeat). Companion is the one the remote needs; MRP comes and goes on its
// own. Either reconnects by itself after a drop, backing off to 30 s, and
// a box asleep behind its sleep proxy is woken by the first connect.
import { Bonjour, type Service } from "bonjour-service";
import { CompanionPairSetup, type HAPCredentials } from "node-appletv-remote";
import { PairSetup } from "node-appletv-remote/dist/auth/pair-setup.js";
import { Mcc, pairError } from "./protocol/companion.ts";
import { MrpLink } from "./protocol/mrp.ts";
import { CompanionSession } from "./protocol/session.ts";
import type { Account, App, ChangeEvent, Conn, Credentials, Driver, Found, Key, Keyboard, Lyrics, MediaCommand, NowPlaying, PairProtocol, Paired, Pairing, Power, Press, QueueItem, Swipe } from "./types.ts";

/** Apple's model identifiers as people say them. */
export const MODELS: Record<string, string> = {
  "AppleTV2,1": "Apple TV (2nd generation)",
  "AppleTV3,1": "Apple TV (3rd generation)",
  "AppleTV3,2": "Apple TV (3rd generation)",
  "AppleTV5,3": "Apple TV HD",
  "AppleTV6,2": "Apple TV 4K",
  "AppleTV11,1": "Apple TV 4K (2nd generation)",
  "AppleTV14,1": "Apple TV 4K (3rd generation)",
};
export const modelName = (model: string) => MODELS[model] ?? "Apple TV";

const CONNECT_TRIES = 4;
const RETRY_MAX_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- discovery --------------------------------------------------------------------------------

const ipv4 = (s: Service) => s.addresses?.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a) && !a.startsWith("169.254."));
const hostKey = (s: Service) => (s.host || s.name).replace(/\.local\.?$/, "").toLowerCase();

/** Apple TVs on the network: `_companion-link._tcp` and `_airplay._tcp` merged by host, anything not an `AppleTV*` dropped. */
export function scan(timeoutMs: number): Promise<Found[]> {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const seen = new Map<string, Partial<Found> & { name?: string }>();
    const at = (s: Service) => { const k = hostKey(s); let f = seen.get(k); if (!f) seen.set(k, (f = {})); return f; };
    bonjour.find({ type: "airplay", protocol: "tcp" }, (s) => {
      const f = at(s), txt = (s.txt ?? {}) as Record<string, string>;
      Object.assign(f, { name: s.name, address: ipv4(s) ?? f.address, airplayPort: s.port, id: txt.deviceid ?? f.id, model: txt.model ?? f.model, os: txt.osvers ?? f.os });
    });
    bonjour.find({ type: "companion-link", protocol: "tcp" }, (s) => {
      const f = at(s), txt = (s.txt ?? {}) as Record<string, string>;
      Object.assign(f, { name: f.name ?? s.name, address: f.address ?? ipv4(s), companionPort: s.port, model: f.model ?? txt.rpMd, id: f.id ?? txt.rpMRtID });
    });
    setTimeout(() => {
      bonjour.destroy();
      const found = [...seen.values()]
        .filter((f): f is Found => !!f.address && !!f.model?.startsWith("AppleTV") && !!(f.id || f.address))
        .map((f) => ({ ...f, id: f.id || f.address, modelName: modelName(f.model) }));
      resolve(found.sort((a, b) => a.name.localeCompare(b.name)));
    }, timeoutMs);
  });
}

// ---- pairing ----------------------------------------------------------------------------------

const toHex = (c: HAPCredentials): Credentials => ({ clientId: c.clientId, clientLTSK: c.clientLTSK.toString("hex"), clientLTPK: c.clientLTPK.toString("hex"), serverLTPK: c.serverLTPK.toString("hex"), serverId: c.serverId });
export const fromHex = (c: Credentials): HAPCredentials => ({ clientId: c.clientId, clientLTSK: Buffer.from(c.clientLTSK, "hex"), clientLTPK: Buffer.from(c.clientLTPK, "hex"), serverLTPK: Buffer.from(c.serverLTPK, "hex"), serverId: c.serverId });

/** A pairing failure in plain words: the HAP error code the library leaves in its message (`error=2`), a timeout, a refused connection. */
export function pairFailure(e: unknown): Error {
  const m = errorMessage(e);
  const code = /error=(\d+)/.exec(m)?.[1];
  if (code) return new Error(pairError(Number(code)) ?? m);
  if (/timeout|timed out/i.test(m)) return new Error("The Apple TV did not answer; is it on and on this network?");
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/.test(m)) return new Error("Could not reach the Apple TV; is it on and on this network?");
  if (/decrypt|authentic|tag|signature/i.test(m)) return new Error("Pairing was refused: the PIN was wrong");
  return new Error(m);
}

async function pair(found: Found, protocol: PairProtocol): Promise<Pairing> {
  const setup = protocol === "companion"
    ? new CompanionPairSetup(found.address, found.companionPort ?? 49153)
    : new PairSetup(found.address, found.airplayPort ?? 7000);
  try { await setup.start(); } catch (e) { setup.destroy(); throw pairFailure(e); }
  return {
    finish: async (pin) => {
      try { return toHex(await setup.finish(pin.replace(/\D/g, ""))); } catch (e) { throw pairFailure(e); } finally { setup.destroy(); }
    },
    cancel: () => setup.destroy(),
  };
}

// ---- app icons --------------------------------------------------------------------------------

const icons = new Map<string, Promise<string | undefined>>();
/** The App Store's artwork for a bundle id (`kind` square: the iOS icon; tv: the 5:3 tvOS one), from the iTunes lookup; Apple's own apps have none. */
export function lookupIcon(bundleId: string, kind: "square" | "tv" = "square"): Promise<string | undefined> {
  const key = `${kind}:${bundleId}`;
  let p = icons.get(key);
  if (!p) {
    p = (async () => {
      const get = async (entity: string) => {
        const r = await fetch(`https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&entity=${entity}`, { signal: AbortSignal.timeout(5000) });
        const j = (await r.json()) as { results?: { artworkUrl512?: string; artworkUrl100?: string }[] };
        return j.results?.[0]?.artworkUrl512 ?? j.results?.[0]?.artworkUrl100;
      };
      // The tvOS icon is layered and 5:3; the image service renders it to the box asked for, 400x240 here (under the 96 KB a view image may be).
      if (kind === "tv") return (await get("tvSoftware"))?.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/400x240bb.$1");
      // A tvOS-only app has no iOS icon: its tvOS one, centre-cropped square by the image service.
      return (await get("software")) ?? (await get("tvSoftware"))?.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/512x512cc.$1");
    })().catch(() => { icons.delete(key); return undefined; });
    icons.set(key, p);
  }
  return p;
}

// ---- the connection ---------------------------------------------------------------------------

class RealConn implements Conn {
  private companion?: CompanionSession;
  private mrp?: MrpLink;
  private listeners = new Set<(e: ChangeEvent) => void>();
  private closing = false;
  private mrpKeyboard: Pick<Keyboard, "title" | "prompt" | "secure"> = {};
  private last = { power: "unknown" as Power, volume: undefined as number | undefined, focused: false, text: undefined as string | undefined };
  private retry = { companion: 0, mrp: 0 };
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private connecting?: Promise<void>;

  constructor(readonly device: Paired) {}

  get companionUp() { return !!this.companion && !this.companion.link.closed; }
  get mrpUp() { return !!this.mrp && !this.mrp.closed; }

  private emit(e: ChangeEvent): void { for (const l of this.listeners) l(e); }

  /** Companion, with a few tries a second or more apart: a sleeping box wakes on the first SYN and answers the next. */
  async openCompanion(): Promise<void> {
    if (!this.device.companion) throw new Error(`${this.device.name} is not paired; run Set up Apple TV`);
    let last: unknown;
    for (let i = 0; i < CONNECT_TRIES && !this.closing; i++) {
      try {
        this.companion = await CompanionSession.open(this.device.address, this.device.companionPort ?? 49153, this.device.companion, () => this.companionChanged());
        this.companion.link.onClose((e) => this.dropped("companion", e));
        this.retry.companion = 0;
        this.companionChanged();
        this.emit({ kind: "connection", up: true });
        return;
      } catch (e) {
        last = e;
        if (/identity|refused the saved pairing/i.test(errorMessage(e))) break;
        await sleep(1000 * (i + 1));
      }
    }
    throw new Error(`${this.device.name} did not answer: ${errorMessage(last)}`);
  }

  async openMrp(): Promise<void> {
    if (!this.device.airplay) return;
    const link = new MrpLink(this.device.address, this.device.airplayPort ?? 7000, fromHex(this.device.airplay));
    link.onMessage((m) => {
      if (m.type === 23) {
        const k = m[".keyboardMessage"] as { state?: number; attributes?: { title?: string; prompt?: string; inputTraits?: { secureTextEntry?: boolean } } } | undefined;
        this.mrpKeyboard = k?.state === 1 ? { title: k.attributes?.title || undefined, prompt: k.attributes?.prompt || undefined, secure: k.attributes?.inputTraits?.secureTextEntry || undefined } : {};
        this.emit({ kind: "keyboard" });
      } else if (m.type === 52) this.emit({ kind: "volume" });
      else this.emit({ kind: "now_playing" });
    });
    await link.open();
    this.mrp = link;
    link.onClose((e) => this.dropped("mrp", e));
    this.retry.mrp = 0;
    this.emit({ kind: "now_playing" });
  }

  private companionChanged(): void {
    const s = this.companion?.state;
    if (!s) return;
    if (s.power !== this.last.power) this.emit({ kind: "power" });
    if (s.volume !== this.last.volume) this.emit({ kind: "volume" });
    if (s.focused !== this.last.focused || s.text !== this.last.text) this.emit({ kind: "keyboard" });
    this.last = { power: s.power, volume: s.volume, focused: s.focused, text: s.text };
  }

  /** MRP, or a retry later when it does not come up: the remote works without it. */
  async startMrp(): Promise<void> {
    try { await this.openMrp(); } catch (e) {
      console.error(`[appletv] ${this.device.name}: no media channel: ${errorMessage(e)}`);
      this.dropped("mrp", e instanceof Error ? e : new Error(errorMessage(e)));
    }
  }

  /** A channel went: say so (the connection is Companion's; MRP going only empties now playing), then bring it back with a backoff (1, 2, 4 ... 30 s). */
  private dropped(which: "companion" | "mrp", e?: Error): void {
    if (this.closing) return;
    if (which === "companion") { this.companion = undefined; this.emit({ kind: "connection", up: false, error: e?.message }); }
    else { this.mrp = undefined; this.emit({ kind: "now_playing" }); }
    const wait = Math.min(RETRY_MAX_MS, 1000 * 2 ** this.retry[which]++);
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.closing) return;
      (which === "companion" ? this.openCompanion() : this.openMrp()).catch(() => this.dropped(which, e));
    }, wait);
    this.timers.add(t);
  }

  /** The Companion session, reconnecting now when it is down (a key pressed after the box slept). */
  private async c(): Promise<CompanionSession> {
    if (this.companionUp) return this.companion!;
    this.connecting ??= this.openCompanion().finally(() => { this.connecting = undefined; });
    await this.connecting;
    return this.companion!;
  }

  async key(key: Key, press?: Press) { await (await this.c()).key(key, press); }
  async swipe(direction: Swipe) { await (await this.c()).swipe(direction); }
  async touch(x: number, y: number) { await (await this.c()).touch(x, y); }

  /** MRP when it is up (every command, with its option); else what Companion's media control and buttons can do. */
  async media(command: MediaCommand, arg?: number): Promise<void> {
    if (this.mrpUp) return this.mrp!.command(command, arg);
    const c = await this.c();
    switch (command) {
      case "play": await c.mcc(Mcc.play); return;
      case "pause": case "stop": await c.mcc(Mcc.pause); return;
      case "toggle": await c.key("play_pause"); return;
      case "next": await c.mcc(Mcc.next); return;
      case "previous": await c.mcc(Mcc.previous); return;
      case "skip_forward": await c.skipBy(arg ?? 10); return;
      case "skip_backward": await c.skipBy(-(arg ?? 10)); return;
      default: throw new Error("That needs the AirPlay pairing too: run Set up Apple TV again");
    }
  }

  nowPlaying(): NowPlaying | undefined { return this.mrp?.players.nowPlaying(); }
  async artwork(width: number, height: number) { return this.mrpUp ? this.mrp!.artwork(width, height) : null; }

  /** The MRP link, or the words for why there is none: what plays needs the AirPlay pairing. */
  private m(): MrpLink {
    if (this.mrpUp) return this.mrp!;
    throw new Error(this.device.airplay ? "The media channel is not up yet; try again in a moment" : "That needs the AirPlay pairing too: run Set up Apple TV again");
  }
  async queue(count: number, artwork?: number): Promise<QueueItem[]> { return this.mrpUp ? this.mrp!.queue(count, artwork) : []; }
  async playQueueItem(id: string) { await this.m().playQueueItem(id); }
  async lyrics(): Promise<Lyrics | null> { return this.mrpUp ? this.mrp!.lyrics() : null; }
  async setLanguage(kind: "audio" | "subtitles", id: string | null) { await this.m().setLanguage(kind, id); }
  async setRate(rate: number) { await this.m().setRate(rate); }

  power(): Power { return this.companion?.state.power ?? "unknown"; }
  async turnOn() { await (await this.c()).power(true); }
  async turnOff() { await (await this.c()).power(false); }

  volume() { return this.companion?.state.volume; }
  async setVolume(level: number) { await (await this.c()).setVolume(level); this.companionChanged(); }

  async apps(): Promise<App[]> { return (await this.c()).apps(); }
  async launch(target: string) { await (await this.c()).launch(target); }
  async accounts(): Promise<Account[]> { return (await this.c()).accounts(); }
  async switchAccount(id: string) { await (await this.c()).switchAccount(id); }

  keyboard(): Keyboard {
    const s = this.companion?.state;
    return { focused: !!s?.focused, text: s?.text, ...(s?.focused ? this.mrpKeyboard : {}) };
  }
  async setText(text: string) { await (await this.c()).text(text, true); this.companionChanged(); }
  async appendText(text: string) { await (await this.c()).text(text, false); this.companionChanged(); }
  async clearText() { await (await this.c()).text("", true); this.companionChanged(); }

  on(listener: (e: ChangeEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  async close(): Promise<void> {
    this.closing = true;
    
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.mrp?.close();
    await this.companion?.close();
    this.listeners.clear();
  }
}

/** Companion first (the remote works from then on), then MRP, whose failure only leaves now playing empty. */
async function connect(device: Paired): Promise<Conn> {
  const conn = new RealConn(device);
  await conn.openCompanion();
  await conn.startMrp();
  return conn;
}

export const realDriver: Driver = { scan, pair, connect, appIcon: (id, kind) => lookupIcon(id, kind) };
