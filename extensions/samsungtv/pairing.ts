// The guided pairing's state machine (setup.ts draws it): look for the
// TVs, open the remote channel without a token so the chosen TV asks
// "Allow pal?", keep the token Allow hands out, make the TV current, then
// connect and read what works for the Ready step. While the prompt is up
// the wait counts down once a second; every change is pushed into the
// open setup level.
import { settings, storage, toast, view as liveView, type Ctx, type Effect } from "@zcag/pal";
import { render as renderSetup, type Check, type SetupState } from "./setup.ts";
import { appsOf, cfg, current, driver, drop, ensure, paired, plain, push, savePaired, tv, NAME } from "./tv.ts";
import type { App, Found, Pairing, Paired } from "./types.ts";

/** How long the TV keeps its Allow prompt up (device.ts PAIR_MS). */
const ALLOW_MS = 35_000;

let setup: SetupState = { phase: "find", scanning: false };
let found: Found[] = [];
let scannedAt = 0;
let scanning: Promise<void> | undefined;
let pairing: Pairing | undefined;
let countdown: ReturnType<typeof setInterval> | undefined;
let typingAddress: string | undefined;

const view = async () => renderSetup(setup, found, await paired(), typingAddress);
function pushSetup(): void {
  void view().then((v) => liveView.update(v, { palette: "setup", id: "setup", extension: NAME }).catch(() => {}));
}

function scan(): void {
  if (scanning) return;
  setup = { phase: "find", scanning: true };
  scanning = (async () => {
    try { found = await (await driver()).scan(4000); setup = { phase: "find", scanning: false }; }
    catch (e) { setup = { phase: "find", scanning: false, error: `Could not look: ${plain(e)}` }; }
    scannedAt = Date.now(); scanning = undefined;
    pushSetup();
  })();
}

const stopCountdown = () => { if (countdown) clearInterval(countdown); countdown = undefined; };

/** Ask the TV to allow pal, and wait for the answer. */
function askAllow(device: Found): void {
  pairing?.cancel();
  stopCountdown();
  setup = { phase: "allow", device, until: Date.now() + ALLOW_MS };
  countdown = setInterval(() => { if (setup.phase === "allow") pushSetup(); else stopCountdown(); }, 1000);
  void (async () => {
    try {
      pairing = await (await driver()).pair(device);
      const token = await pairing.token;
      pairing = undefined;
      stopCountdown();
      await finish(device, token);
    } catch (e) {
      pairing = undefined;
      stopCountdown();
      if (setup.phase !== "allow" || setup.device.id !== device.id) return;
      setup = { phase: "failed", device, error: plain(e), hint: "Pressed Deny before? The TV remembers it: Settings › General › External Device Manager › Device Connection Manager › Device List, remove pal there, then try again. Access Notification there should be on, so the TV asks." };
    }
    pushSetup();
  })();
}

async function savePairing(device: Found, token: string): Promise<Paired> {
  const list = (await paired()).filter((d) => d.id !== device.id);
  const p: Paired = { id: device.id, name: device.name, address: device.address, model: device.model, mac: device.mac, token, pairedAt: Date.now() };
  await savePaired([...list, p]);
  await settings.set({ device: p.name }, NAME).catch(() => {});
  return p;
}

/** Connect to the freshly paired TV and read what works: the checks of the Ready step. */
async function check(p: Paired): Promise<Check[]> {
  await drop();
  const c = await ensure();
  const checks: Check[] = [{ ok: c.remoteUp, what: "Remote", detail: c.remoteUp ? "The buttons, typing, opening apps" : "Allowed, but the remote did not open yet" }];
  const apps = await appsOf(p, true).catch(() => [] as App[]);
  checks.push({ ok: apps.length > 0, what: "Apps", detail: apps.length ? `${apps.length} apps found, a digit each for the dock` : "The TV did not list its apps; the remote works without them" });
  const v = c.volume();
  checks.push({ ok: v !== undefined ? true : "skipped", what: "Volume", detail: v !== undefined ? `${v} now; the slider sets it, m mutes` : "The TV did not report its volume: the buttons step it" });
  checks.push({ ok: p.mac ? true : "skipped", what: "Power", detail: p.mac ? "p turns it off and on; from off, Power On with Mobile has to be on" : "p turns it off; the TV did not tell its network address, so pal cannot turn it on from off" });
  checks.push({ ok: true, what: "Inputs", detail: "i moves to the next HDMI input; the input menu is a key away" });
  return checks;
}

async function finish(device: Found, token: string): Promise<void> {
  setup = { phase: "checking", device };
  pushSetup();
  const p = await savePairing(device, token);
  try { setup = { phase: "ready", device: p, checks: await check(p) }; }
  catch (e) { setup = { phase: "ready", device: p, checks: [{ ok: false, what: "Connection", detail: `Paired, but the connection failed: ${plain(e)}` }] }; }
  push();
}

export async function setupView() {
  if (setup.phase === "find" && !scanning && Date.now() - scannedAt > 20_000) scan();
  return view();
}

export async function setupPick(action: string | undefined, ctx?: Ctx): Promise<Effect> {
  const input = String(ctx?.values?.input ?? "").trim();
  switch (action) {
    case "rescan": scannedAt = 0; scan(); break;
    case "type": typingAddress = ""; break;
    case "type:cancel": typingAddress = undefined; break;
    case "pair:typed": {
      typingAddress = undefined;
      if (!/^[\w.:-]+$/.test(input)) { setup = { phase: "find", scanning: false, error: `${input || "Nothing"} is not an address` }; break; }
      const f = found.find((x) => x.address === input) ?? (await (await driver()).probe(input));
      if (!f) { setup = { phase: "find", scanning: false, error: `No Samsung TV answered at ${input}` }; break; }
      if (!found.some((x) => x.id === f.id)) found = [...found, f];
      askAllow(f);
      break;
    }
    case "retry": if (setup.phase === "failed") askAllow(setup.device); break;
    case "back": pairing?.cancel(); pairing = undefined; stopCountdown(); setup = { phase: "find", scanning: false }; break;
    case "remote": return { push: { extension: NAME, palette: "remote" } };
    case "apps": return { push: { extension: NAME, palette: "apps" } };
    case "bar": return { open: "pal://settings/bar" };
    case "forget": {
      const list = await paired(), dev = current(list);
      if (!dev) break;
      if (tv.conn?.device.id === dev.id) await drop();
      await savePaired(list.filter((d) => d.id !== dev.id));
      await storage.set(`apps:${dev.id}`, null, NAME).catch(() => {});
      if (cfg().device?.trim().toLowerCase() === dev.name.toLowerCase()) await settings.set({ device: null }, NAME).catch(() => {});
      push();
      return { ...toast(`Forgot ${dev.name}`, "Remove pal on the TV too: Settings › General › External Device Manager › Device Connection Manager"), view: await view() };
    }
    default:
      if (action?.startsWith("pair:")) { const f = found.find((x) => x.id === action.slice(5)); if (f) askAllow(f); }
  }
  return { view: await view() };
}

export const cancelPairing = () => { pairing?.cancel(); stopCountdown(); };
