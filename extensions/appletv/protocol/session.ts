// The Companion API on one link, pyatv's `CompanionAPI` and its facades:
// the session handshake, buttons (HID) and the touch surface, media
// control (`_mcc`), apps, accounts, the power state and the text field.
// It keeps the box's pushed state (attention, media-control flags,
// volume, keyboard focus) and calls `onChange` when any of it moves.
import { createHash } from "node:crypto";
import { Attention, CompanionLink, Hid, Mcc, McFlags, type Dict } from "./companion.ts";
import { clearPayload, insertPayload, readSession } from "./rti.ts";
import { float } from "./opack.ts";
import type { Account, App, Credentials, Key, Power, Press, Swipe } from "../types.ts";

const TOUCH = 1000;
const TOUCH_STEP_MS = 16;
/** pyatv's `TouchAction`. */
const Touch = { press: 1, hold: 3, release: 4, click: 5 } as const;
const EVENTS = ["_iMC", "SystemStatus", "TVSystemStatus", "_tiStarted", "_tiStopped"];

export type CompanionState = { power: Power; flags?: number; volume?: number; focused: boolean; text?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const powerOf = (state: unknown): Power => (state === Attention.asleep ? "off" : state === Attention.screensaver ? "screensaver" : state === Attention.awake || state === Attention.idle ? "on" : "unknown");

export class CompanionSession {
  readonly state: CompanionState = { power: "unknown", focused: false };
  private sid = 0n;
  private base = process.hrtime.bigint();
  private changed?: () => void;

  constructor(readonly link: CompanionLink) {
    link.onEvent((id, c) => this.event(id, c));
  }

  /** Opens the link and runs the handshake in pyatv's order; the state is read once, then follows the pushed events. */
  static async open(host: string, port: number, creds: Credentials, onChange: () => void, name = "pal"): Promise<CompanionSession> {
    const link = new CompanionLink(host, port, creds);
    await link.open();
    const s = new CompanionSession(link);
    s.changed = onChange;
    // An id of our own for this remote, stable per pairing (pyatv: a missing `_i` stops TVSystemStatus pushes).
    const id = createHash("sha256").update(creds.clientId).digest("hex");
    await link.request("_systemInfo", {
      _bf: 0, _cf: 512, _clFl: 128, _i: id.slice(0, 12), _idsID: creds.clientId, _pubID: id.slice(12, 24).match(/../g)!.join(":").toUpperCase(),
      _sf: 256, _sv: "170.18", model: "iPhone10,6", name,
    }).catch(() => {});
    await s.touchStart();
    const local = Math.floor(Math.random() * 2 ** 32);
    const started = await link.request("_sessionStart", { _srvT: "com.apple.tvremoteservices", _sid: local });
    s.sid = (BigInt(Number(started._sid ?? 0)) << 32n) | BigInt(local);
    // tvOS answers FetchAttentionState only once a TV Remote session is registered; older ones refuse this, harmlessly.
    await link.request("TVRCSessionStart", { ProtocolVersionKey: "1.2" }).catch(() => {});
    s.textStarted(await link.request("_tiStart").catch(() => ({})));
    link.event("_interest", { _regEvents: EVENTS });
    const att = await link.request("FetchAttentionState").catch(() => undefined);
    if (att) s.state.power = powerOf(att.state);
    await s.readVolume();
    return s;
  }

  private event(id: string, c: Dict): void {
    if (id === "_iMC") {
      this.state.flags = Number(c._mcF ?? 0);
      if (this.state.flags & McFlags.volume) { this.readVolume().then(() => this.changed?.()); return; }
      this.state.volume = undefined;
    } else if (id === "SystemStatus" || id === "TVSystemStatus") this.state.power = powerOf(c.state);
    else if (id === "_tiStarted" || id === "_tiStopped") this.textStarted(c);
    else return;
    this.changed?.();
  }

  /** `_tiStart`'s reply and the `_tiStarted`/`_tiStopped` events: a `_tiD` means a field has focus. */
  private textStarted(c: Dict): void {
    const d = c._tiD;
    this.state.focused = d instanceof Uint8Array;
    this.state.text = d instanceof Uint8Array ? readSession(d).text : undefined;
  }

  private async readVolume(): Promise<void> {
    const r = await this.link.request("_mcc", { _mcc: Mcc.getVolume }).catch(() => undefined);
    this.state.volume = typeof r?._vol === "number" ? r._vol : undefined;
  }

  private hid(command: number, down: boolean): Promise<Dict> {
    return this.link.request("_hidC", { _hBtS: down ? 1 : 2, _hidC: command });
  }

  /** A button: down and up, twice for a double tap, held a second for a hold (Home held is Control Center, Select held a context menu). */
  async key(key: Key, press: Press = "tap"): Promise<void> {
    const command = Hid[key];
    await this.hid(command, true);
    if (press === "hold") await sleep(1000);
    await this.hid(command, false);
    if (press === "double") { await this.hid(command, true); await this.hid(command, false); }
  }

  private async touchStart(): Promise<void> {
    this.base = process.hrtime.bigint();
    await this.link.request("_touchStart", { _height: float(TOUCH), _tFl: 0, _width: float(TOUCH) }).catch(() => {});
  }

  private touchEvent(x: number, y: number, phase: number): void {
    const clamp = (v: number) => Math.round(Math.min(TOUCH, Math.max(0, v)));
    this.link.event("_hidT", { _ns: process.hrtime.bigint() - this.base, _tFg: 1, _cx: clamp(x), _tPh: phase, _cy: clamp(y) });
  }

  /** A finger across the touch surface, start to end over `ms`, a point every 16 ms (pyatv's `swipe`). */
  async drag(x0: number, y0: number, x1: number, y1: number, ms = 200): Promise<void> {
    const steps = Math.max(1, Math.round(ms / TOUCH_STEP_MS));
    this.touchEvent(x0, y0, Touch.press);
    for (let i = 1; i < steps; i++) { await sleep(TOUCH_STEP_MS); this.touchEvent(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, Touch.hold); }
    await sleep(TOUCH_STEP_MS);
    this.touchEvent(x1, y1, Touch.release);
  }

  /** A swipe the way the focus moves: `left` drags the finger right to left. */
  swipe(direction: Swipe): Promise<void> {
    const [a, b] = [250, 750], mid = 500;
    const path = { left: [b, mid, a, mid], right: [a, mid, b, mid], up: [mid, b, mid, a], down: [mid, a, mid, b] }[direction];
    return this.drag(path[0], path[1], path[2], path[3]);
  }

  /** A tap at a point of the surface, 0..1000 each way. */
  async touch(x: number, y: number): Promise<void> {
    this.touchEvent(x, y, Touch.press);
    await sleep(TOUCH_STEP_MS * 3);
    this.touchEvent(x, y, Touch.release);
  }

  mcc(command: number, args: Dict = {}): Promise<Dict> { return this.link.request("_mcc", { _mcc: command, ...args }); }
  /** Seconds forward (or back, negative); a float, since OPACK has no negative integers. */
  skipBy(seconds: number): Promise<Dict> { return this.mcc(Mcc.skipBy, { _skpS: float(seconds) }); }
  async setVolume(level: number): Promise<void> { await this.mcc(Mcc.setVolume, { _vol: float(Math.min(1, Math.max(0, level))) }); this.state.volume = level; }

  async apps(): Promise<App[]> {
    const c = await this.link.request("FetchLaunchableApplicationsEvent");
    return Object.entries(c).map(([id, name]) => ({ id, name: String(name) })).sort((a, b) => a.name.localeCompare(b.name));
  }
  /** A bundle id, or a URL (any `scheme:`) the box opens in the app that claims it. */
  async launch(target: string): Promise<void> {
    await this.link.request("_launchApp", /^[a-z][a-z0-9+.-]*:/i.test(target) ? { _urlS: target } : { _bundleID: target });
  }
  async accounts(): Promise<Account[]> {
    const c = await this.link.request("FetchUserAccountsEvent");
    return Object.entries(c).map(([id, name]) => ({ id, name: String(name) }));
  }
  async switchAccount(id: string): Promise<void> { await this.link.request("SwitchUserAccountEvent", { SwitchAccountID: id }); }

  async power(on: boolean): Promise<void> { await this.hid(on ? Hid.wake : Hid.sleep, false); }

  /** pyatv's `text_input_command`: a fresh text session (for its UUID and the current text), then clear and/or insert. Answers the text after. */
  async text(insert: string, clear: boolean): Promise<string | undefined> {
    await this.link.request("_tiStop").catch(() => {});
    const started = await this.link.request("_tiStart");
    this.textStarted(started);
    const d = started._tiD;
    if (!(d instanceof Uint8Array)) return undefined;
    const { uuid, text } = readSession(d);
    if (!uuid) return undefined;
    let now = text;
    if (clear) { this.link.event("_tiC", { _tiV: 1, _tiD: clearPayload(uuid) }); now = ""; }
    if (insert) { this.link.event("_tiC", { _tiV: 1, _tiD: insertPayload(uuid, insert) }); now += insert; }
    this.state.text = now;
    return now;
  }

  /** pyatv's disconnect: drop the subscriptions, stop the sessions, close; errors on the way do not matter. */
  async close(): Promise<void> {
    if (this.link.closed) return;
    try {
      this.link.event("_interest", { _deregEvents: EVENTS });
      await Promise.race([Promise.allSettled([
        this.link.request("_sessionStop", { _srvT: "com.apple.tvremoteservices", _sid: this.sid }, 1000),
        this.link.request("_touchStop", { _i: 1 }, 1000),
        this.link.request("_tiStop", {}, 1000),
      ]), sleep(1500)]);
    } catch { /* closing anyway */ }
    this.link.close();
  }
}
