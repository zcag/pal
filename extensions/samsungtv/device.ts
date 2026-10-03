// The real driver: finds TVs (mDNS `_samsungmsf._tcp`, whose TXT `se`
// names the REST base, plus SSDP for TVs that answer it), pairs (the
// Allow prompt), and keeps one connection per TV. The connection is the
// remote websocket while the screen is on (keys, text, apps, launches),
// and a poll of REST and UPnP every `POLL_MS` for what the websocket does
// not tell: power, volume and mute, the app in front, a DLNA sender's
// media. A remote that drops while the TV is on is reopened with backoff;
// one that drops because the TV went to standby is not.
import * as rest from "./protocol/rest.ts";
import { Remote, KEYS, appsMsg, parseApps, clickMsg, iconMsg, imeText, keyMsg, launchMsg, moveMsg, remoteUrl, textEndMsg, textMsg } from "./protocol/remote.ts";
import { ssdp, wol } from "./protocol/net.ts";
import * as upnp from "./protocol/upnp.ts";
import type { App, AppState, ChangeEvent, Conn, Driver, Found, Input, Key, Keyboard, Media, Paired, Pairing, Power, Press } from "./types.ts";

/** How often REST and UPnP are asked while a connection is open. */
export const POLL_MS = 3000;
/** Connect with a token: the TV answers at once or not at all. */
const CONNECT_MS = 5000;
/** The Allow prompt stays up about 30 s on current TVs. */
export const PAIR_MS = 35_000;
const HOLD_MS = 1000;
const RETRY_MIN_MS = 2000, RETRY_MAX_MS = 30_000;
/** How long a turn-on waits for the TV to say it is on. */
const WAKE_MS = 20_000;
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const INPUTS: Input[] = [
  { id: "source", name: "Sources", sure: true },
  { id: "tv", name: "TV", sure: true },
  { id: "hdmi", name: "HDMI", sure: true },
  { id: "hdmi1", name: "HDMI 1", sure: false }, { id: "hdmi2", name: "HDMI 2", sure: false },
  { id: "hdmi3", name: "HDMI 3", sure: false }, { id: "hdmi4", name: "HDMI 4", sure: false },
];

/**
 * Where the driver talks: the TV's own ports by default; the tests point
 * every channel at one local server (`port`, plain ws) instead.
 */
export type Wiring = { port?: number; secure?: boolean; pollMs?: number };

export function makeDriver(w: Wiring = {}): Driver {
  const restPort = w.port ?? 8001, upnpPort = w.port ?? 9197;
  const remote = (address: string, token?: string) => remoteUrl(address, token, { port: w.port, secure: w.secure ?? !w.port });
  const probe = (address: string) => rest.info(address, 2000, restPort);

  return {
    probe,
    async scan(timeoutMs) {
      const [m, s] = await Promise.all([mdns(timeoutMs).catch(() => []), ssdp(timeoutMs).catch(() => [])]);
      const found = (await Promise.all([...new Set([...m, ...s])].map((a) => probe(a)))).filter((f): f is Found => !!f && f.tokenAuth);
      return [...new Map(found.map((f) => [f.id, f])).values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    async pair(found) {
      let cancel = () => {};
      const token = (async () => {
        const r = await Promise.race([
          Remote.connect(remote(found.address), PAIR_MS),
          new Promise<never>((_, rej) => { cancel = () => rej(new Error("The pairing was cancelled")); }),
        ]);
        r.close();
        if (!r.token) throw new Error(`${found.name} allowed pal but gave no token; is it a 2016 or later Tizen TV?`);
        return r.token;
      })();
      return { token, cancel: () => cancel() } satisfies Pairing;
    },
    async connect(device) {
      const c = new RealConn(device, { remote, restPort, upnpPort, pollMs: w.pollMs ?? POLL_MS });
      await c.start();
      return c;
    },
    async wake(device) {
      if (!device.mac) throw new Error("The TV's MAC address is not known, so it cannot be woken; turn it on once by hand");
      await wol(device.mac, device.address);
    },
  };
}

export const realDriver = makeDriver();

/**
 * TVs answering mDNS: `_samsungmsf._tcp` (the TXT's `se` is the REST base,
 * `http://<ip>:8001/api/v2/`), and `_airplay._tcp` with
 * `manufacturer=Samsung`: on hornet bonjour-service never heard the
 * former from a 2024 TV that `dns-sd -B` lists, while the latter came at once.
 */
async function mdns(timeoutMs: number): Promise<string[]> {
  const { Bonjour } = await import("bonjour-service");
  return new Promise((resolve) => {
    const b = new Bonjour(), out = new Set<string>();
    const ipv4 = (xs?: string[]) => xs?.find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x) && !x.startsWith("169.254."));
    const txt = (s: { txt?: unknown }) => (s.txt ?? {}) as Record<string, string>;
    b.find({ type: "samsungmsf", protocol: "tcp" }, (s) => {
      const a = /^https?:\/\/([^:/]+)/.exec(String(txt(s).se ?? ""))?.[1] ?? ipv4(s.addresses);
      if (a) out.add(a);
    });
    b.find({ type: "airplay", protocol: "tcp" }, (s) => {
      const a = /samsung/i.test(txt(s).manufacturer ?? "") ? ipv4(s.addresses) : undefined;
      if (a) out.add(a);
    });
    setTimeout(() => { b.destroy(); resolve([...out]); }, timeoutMs);
  });
}

type Wired = { remote: (address: string, token?: string) => string; restPort: number; upnpPort: number; pollMs: number };

class RealConn implements Conn {
  private r: Remote | undefined;
  private opening: Promise<void> | undefined;
  private listeners = new Set<(e: ChangeEvent) => void>();
  private closed = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = RETRY_MIN_MS;
  private retryAt = 0;
  token: string;
  private st: { power: Power; volume?: number; muted?: boolean; front?: AppState; media?: Media; keyboard: Keyboard } = { power: "unknown", keyboard: { open: false } };
  private appList: App[] | undefined;

  constructor(readonly device: Paired, private w: Wired) { this.token = device.token; }

  get remoteUp() { return !!this.r?.open; }
  private emit(e: ChangeEvent) { for (const l of this.listeners) { try { l(e); } catch {} } }

  /** The first poll, then the remote when the screen is on: a TV in standby still connects, with keys waiting for it to wake. */
  async start() {
    await this.poll();
    if (this.st.power === "off") throw new Error(`${this.device.name} does not answer; is it on and on this network?`);
    if (this.st.power === "on") await this.openRemote().catch(() => {});
    this.schedule();
  }

  private schedule() {
    if (this.closed) return;
    this.pollTimer = setTimeout(async () => { await this.poll().catch(() => {}); this.schedule(); }, this.w.pollMs);
  }

  /** One round of REST and UPnP; each change said once. */
  private async poll() {
    const a = this.device.address;
    const info = await rest.info(a, 2000, this.w.restPort);
    const power: Power = info?.power ?? "off";
    if (power !== this.st.power) {
      this.st.power = power;
      this.emit({ kind: "power" });
      if (power !== "on") { this.st.volume = this.st.muted = undefined; this.setFront(undefined); this.setMedia(undefined); }
    }
    if (power !== "on") return;
    if (!this.r && !this.opening && Date.now() >= this.retryAt) void this.openRemote().catch(() => {});
    const [vol, mute, media, front] = await Promise.all([
      upnp.soap(a, upnp.RC, "GetVolume", { Channel: "Master" }, 2000, this.w.upnpPort).then((f) => Number(f.CurrentVolume), () => undefined),
      upnp.soap(a, upnp.RC, "GetMute", { Channel: "Master" }, 2000, this.w.upnpPort).then((f) => f.CurrentMute === "1", () => undefined),
      this.readMedia().catch(() => undefined),
      this.readFront(),
    ]);
    if ((vol !== undefined && !Number.isNaN(vol) && vol !== this.st.volume) || (mute !== undefined && mute !== this.st.muted)) {
      if (vol !== undefined && !Number.isNaN(vol)) this.st.volume = vol;
      if (mute !== undefined) this.st.muted = mute;
      this.emit({ kind: "volume" });
    }
    this.setMedia(media);
    this.setFront(front);
  }

  private async readMedia() {
    const [t, p] = await Promise.all([upnp.soap(this.device.address, upnp.AVT, "GetTransportInfo", {}, 2000, this.w.upnpPort), upnp.soap(this.device.address, upnp.AVT, "GetPositionInfo", {}, 2000, this.w.upnpPort)]);
    return upnp.mediaOf(t, p, Date.now());
  }

  /** The visible app among those listed (the catalog's when no list was read yet). */
  private async readFront(): Promise<AppState | undefined> {
    const ids = (this.appList ?? rest.CATALOG).map((x) => x.id);
    const states = await Promise.all(ids.map((id) => rest.appState(this.device.address, id, 2000, this.w.restPort)));
    return states.find((s) => s?.visible);
  }

  private setFront(f: AppState | undefined) {
    if (f?.id === this.st.front?.id && f?.visible === this.st.front?.visible) return;
    this.st.front = f; this.emit({ kind: "app" });
  }
  private setMedia(m: Media | undefined) {
    const k = (x?: Media) => (x ? `${x.state}|${x.url}|${x.position}` : "");
    if (k(m) === k(this.st.media)) return;
    this.st.media = m; this.emit({ kind: "media" });
  }

  /** Open the remote (one attempt at a time); a later drop schedules the next attempt, backing off. */
  private openRemote(): Promise<void> {
    if (this.r?.open) return Promise.resolve();
    return (this.opening ??= (async () => {
      try {
        const r = await Remote.connect(this.w.remote(this.device.address, this.token), CONNECT_MS);
        if (this.closed) { r.close(); return; }
        this.r = r; this.retryMs = RETRY_MIN_MS;
        if (r.token && r.token !== this.token) { this.token = r.token; this.emit({ kind: "token", token: r.token }); }
        r.on((e) => this.onEvent(e.event, e.data));
        r.onClose((why) => {
          if (this.r !== r) return;
          this.r = undefined;
          if (this.st.keyboard.open) { this.st.keyboard = { open: false }; this.emit({ kind: "keyboard" }); }
          this.emit({ kind: "connection", up: false, error: why });
          this.retryAt = Date.now() + this.retryMs; this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
        });
        this.emit({ kind: "connection", up: true });
      } catch (e) {
        this.retryAt = Date.now() + this.retryMs; this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
        this.emit({ kind: "connection", up: false, error: errorMessage(e) });
        throw e;
      } finally { this.opening = undefined; }
    })());
  }

  private onEvent(event: string, data: any) {
    if (event === "ms.remote.imeStart") this.st.keyboard = { open: true };
    else if (event === "ms.remote.imeUpdate") this.st.keyboard = { open: true, text: imeText(data) };
    else if (event === "ms.remote.imeEnd") this.st.keyboard = { open: false };
    else return;
    this.emit({ kind: "keyboard" });
  }

  /** The remote, opened now when the TV is on and it is not; why not, in words. */
  private async remote(): Promise<Remote> {
    if (this.r?.open) return this.r;
    // Network standby keeps the websocket on some TVs (KEY_POWER wakes from there); off is off.
    if (this.st.power === "off") throw new Error(`${this.device.name} is off`);
    await this.openRemote();
    if (!this.r) throw new Error("The TV's remote is not connected");
    return this.r;
  }

  async rawKey(code: string, press: Press = "tap") {
    const r = await this.remote();
    if (press === "tap") return r.send(keyMsg(code));
    r.send(keyMsg(code, "Press"));
    await sleep(HOLD_MS);
    r.send(keyMsg(code, "Release"));
  }
  key(key: Key, press?: Press) { return this.rawKey(KEYS[key], press); }
  async pointer(dx: number, dy: number) { (await this.remote()).send(moveMsg(dx, dy)); }
  async click() { (await this.remote()).send(clickMsg()); }

  power() { return this.st.power; }

  /** Standby with a working remote: KEY_POWER. Always Wake-on-LAN too (off, or a remote that will not open), then wait for "on". */
  async turnOn() {
    if (this.st.power === "on") return;
    if (this.st.power === "standby") await this.rawKey(KEYS.power).catch(() => {});
    if (this.device.mac) await wol(this.device.mac, this.device.address).catch(() => {});
    const until = Date.now() + WAKE_MS;
    while (Date.now() < until && !this.closed) {
      await this.poll().catch(() => {});
      if (this.power() === "on") return;
      await sleep(1000);
    }
    throw new Error(this.device.mac ? `${this.device.name} did not wake; is "Power on with mobile" on in its settings?` : `${this.device.name} did not wake, and its MAC address is not known for Wake-on-LAN`);
  }
  async turnOff() {
    if (this.st.power !== "on") return;
    await this.rawKey(KEYS.power);
  }

  volume() { return this.st.volume; }
  async setVolume(level: number) {
    const v = Math.round(Math.min(100, Math.max(0, level)));
    await upnp.soap(this.device.address, upnp.RC, "SetVolume", { Channel: "Master", DesiredVolume: v }, 2000, this.w.upnpPort);
    if (v !== this.st.volume) { this.st.volume = v; this.emit({ kind: "volume" }); }
  }
  muted() { return this.st.muted; }
  async setMuted(m: boolean) {
    await upnp.soap(this.device.address, upnp.RC, "SetMute", { Channel: "Master", DesiredMute: m ? 1 : 0 }, 2000, this.w.upnpPort);
    if (m !== this.st.muted) { this.st.muted = m; this.emit({ kind: "volume" }); }
  }

  inputs() { return INPUTS; }
  setInput(id: Input["id"]) { return this.rawKey(KEYS[id]); }

  /** `ed.installedApp.get` when the remote is up and it answers with apps; else every catalog app the TV has, over REST. */
  async apps(): Promise<App[]> {
    if (this.r?.open || this.st.power === "on") {
      const r = await this.remote().catch(() => undefined);
      const e = r && (await r.request(appsMsg(), "ed.installedApp.get", 5000).catch(() => undefined));
      const listed = e ? parseApps(e.data) : [];
      if (listed.length) return (this.appList = listed);
    }
    const states = await Promise.all(rest.CATALOG.map((a) => rest.appState(this.device.address, a.id, 2000, this.w.restPort)));
    const seen = new Set<string>(), out: App[] = [];
    rest.CATALOG.forEach((a, i) => { if (states[i] && !seen.has(a.name)) { seen.add(a.name); out.push({ id: a.id, name: a.name }); } });
    return (this.appList = out);
  }
  foreground() { return this.st.front; }

  async launch(id: string, meta?: string) {
    const r = this.r?.open ? this.r : await this.remote().catch(() => undefined);
    if (r) return r.send(launchMsg(id, this.appList?.find((a) => a.id === id)?.type, meta));
    if (meta !== undefined) throw new Error("The TV's remote is not connected, and only it opens a link in an app");
    await rest.appRequest(this.device.address, id, "POST", 3000, this.w.restPort);
  }
  quit(id: string) { return rest.appRequest(this.device.address, id, "DELETE", 3000, this.w.restPort); }
  async icon(app: App): Promise<Uint8Array | null> {
    if (!app.icon) return null;
    const e = await (await this.remote()).request(iconMsg(app.icon), "ed.apps.icon", 5000);
    const b64 = e?.data?.imageBase64;
    return typeof b64 === "string" && b64 ? new Uint8Array(Buffer.from(b64, "base64")) : null;
  }
  browse(url: string) { return this.launch("org.tizen.browser", url); }

  media() { return this.st.media; }
  keyboard() { return this.st.keyboard; }
  async type(text: string, done = false) {
    const r = await this.remote();
    if (text) r.send(textMsg(text));
    if (done) r.send(textEndMsg());
  }

  on(l: (e: ChangeEvent) => void) { this.listeners.add(l); return () => this.listeners.delete(l); }
  async close() {
    this.closed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.listeners.clear();
    this.r?.close(); this.r = undefined;
  }
}
