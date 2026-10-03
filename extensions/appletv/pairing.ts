// The guided pairing's state machine (setup.ts draws it): look for the
// Apple TVs, put a code on the chosen one's screen for Companion, then for
// AirPlay (skippable), keep the keys, make it current, then connect and
// read what works for the Ready step. A wrong code asks the TV for a new
// one by itself; every change is pushed into the open setup level.
import { settings, storage, toast, view as liveView, type Ctx, type Effect } from "@zcag/pal";
import { render as renderSetup, type Check, type SetupState } from "./setup.ts";
import { appsOf, cfg, current, driver, drop, ensure, paired, plain, push, savePaired, tv, NAME } from "./tv.ts";
import { watchClipboard } from "./play.ts";
import type { App, Credentials, Found, Pairing, PairProtocol, Paired } from "./types.ts";


let setup: SetupState = { phase: "find", scanning: false };
let found: Found[] = [];
let scannedAt = 0;
let scanning: Promise<void> | undefined;
let pairing: Pairing | undefined;
let companionCreds: Credentials | undefined;
let typingAddress: string | undefined;

function pushSetup(): void {
  void paired().then((list) => liveView.update(renderSetup(setup, found, list, typingAddress), { palette: "setup", id: "setup", extension: NAME }).catch(() => {}));
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

/** Put a code on the TV for `protocol` and wait for it to be typed. */
function askPin(device: Found, protocol: PairProtocol, error?: string, tries = 0): void {
  pairing?.cancel();
  pairing = undefined;
  setup = { phase: "pin", protocol, device, asking: true, error, tries };
  void (async () => {
    try {
      // A sleeping TV is woken by the connection itself; give it the time to draw the code.
      pairing = await (await driver()).pair(device, protocol);
      if (setup.phase === "pin" && setup.device.id === device.id) setup = { ...setup, asking: false };
    } catch (e) {
      setup = { phase: "failed", device, protocol, error: plain(e), hint: protocol === "companion" ? "On the Apple TV: Settings › Remotes and Devices › Remote App and Devices should list pal while the code shows. If no code appears, check Settings › AirPlay and HomeKit › Allow Access." : "On the Apple TV: Settings › AirPlay and HomeKit › Allow Access set to Everyone on the Same Network lets the code appear; you can also skip this step." };
    }
    pushSetup();
  })();
}

async function savePairing(device: Found, companion: Credentials, airplay?: Credentials): Promise<Paired> {
  const list = (await paired()).filter((d) => d.id !== device.id);
  const p: Paired = { id: device.id, name: device.name, address: device.address, model: device.model, modelName: device.modelName, companionPort: device.companionPort, airplayPort: device.airplayPort, companion, airplay, pairedAt: Date.now() };
  await savePaired([...list, p]);
  await settings.set({ device: p.name }, NAME).catch(() => {});
  void watchClipboard();
  return p;
}

/** Connect to the freshly paired TV and read what works: the checks of the Ready step. */
async function check(p: Paired): Promise<Check[]> {
  await drop();
  const c = await ensure();
  const checks: Check[] = [{ ok: true, what: "Remote", detail: "Buttons, swipes, sleep and wake" }];
  const apps = await appsOf(p, true).catch(() => [] as App[]);
  checks.push({ ok: apps.length > 0, what: "Apps", detail: apps.length ? `${apps.length} apps, a digit each for the dock` : "The TV did not list its apps" });
  checks.push({ ok: true, what: "Typing", detail: "Into any text field the TV shows (t on the remote)" });
  const v = c.volume();
  checks.push({ ok: v !== undefined ? true : "skipped", what: "Volume", detail: v !== undefined ? `${Math.round(v * 100)}% now; the slider sets it` : "The TV does not report its volume: the buttons step it" });
  if (!p.airplay) checks.push({ ok: "skipped", what: "Now playing", detail: "Skipped: the remote works without it; Set Up again adds it" });
  else { const n = c.nowPlaying(); checks.push({ ok: c.mrpUp, what: "Now playing", detail: c.mrpUp ? (n?.title ? `${n.title}${n.app?.name ? ` in ${n.app.name}` : ""}` : "Nothing playing right now; the bar item shows it when something does") : "Paired, but the TV did not answer yet" }); }
  const accounts = await c.accounts().catch(() => []);
  if (accounts.length > 1) checks.push({ ok: true, what: "Users", detail: `${accounts.length} people: u switches` });
  return checks;
}

function finish(device: Found, companion: Credentials, airplay?: Credentials): void {
  setup = { phase: "checking", device };
  void (async () => {
    const p = await savePairing(device, companion, airplay);
    try { setup = { phase: "ready", device: p, checks: await check(p) }; }
    catch (e) { setup = { phase: "ready", device: p, checks: [{ ok: false, what: "Connection", detail: `Paired, but the connection failed: ${plain(e)}` }] }; }
    pushSetup(); push();
  })();
}

export async function setupView(): Promise<ReturnType<typeof renderSetup>> {
  if (setup.phase === "find" && !scanning && Date.now() - scannedAt > 20_000) scan();
  return renderSetup(setup, found, await paired(), typingAddress);
}

export async function setupPick(action: string | undefined, ctx?: Ctx): Promise<Effect> {
  const input = String(ctx?.values?.input ?? "").trim();
  const byId = (id: string) => found.find((f) => f.id === id);
  switch (action) {
    case "rescan": scannedAt = 0; scan(); break;
    case "type": typingAddress = ""; break;
    case "type:cancel": typingAddress = undefined; break;
    case "pair:typed": {
      typingAddress = undefined;
      if (!/^[\w.:-]+$/.test(input)) { setup = { phase: "find", scanning: false, error: `${input || "Nothing"} is not an address` }; break; }
      const f = found.find((x) => x.address === input) ?? { id: input, name: input, address: input, model: "AppleTV", modelName: "Apple TV", companionPort: 49153, airplayPort: 7000 };
      if (!found.includes(f)) found = [...found, f];
      companionCreds = undefined; askPin(f, "companion");
      break;
    }
    case "pin": {
      if (setup.phase !== "pin" || !pairing) break;
      const st = setup;
      if (!/^\d{4}$/.test(input)) { setup = { ...st, error: "The code is four digits", tries: st.tries + 1 }; break; }
      try {
        const creds = await pairing.finish(input);
        pairing = undefined;
        if (st.protocol === "companion") { companionCreds = creds; askPin(st.device, "airplay"); }
        else finish(st.device, companionCreds!, creds);
      } catch (e) {
        askPin(st.device, st.protocol, plain(e), st.tries + 1);
      }
      break;
    }
    case "pin:again": if (setup.phase === "pin") askPin(setup.device, setup.protocol, undefined, setup.tries); break;
    case "skip": if (setup.phase === "pin" && companionCreds) { pairing?.cancel(); pairing = undefined; finish(setup.device, companionCreds); } break;
    case "back": pairing?.cancel(); pairing = undefined; setup = { phase: "find", scanning: false }; break;
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
      return { ...toast(`Forgot ${dev.name}`, "Remove pal on the TV too: Settings › Remotes and Devices"), view: renderSetup(setup, found, await paired(), typingAddress) };
    }
    default:
      if (action?.startsWith("pair:")) { const f = byId(action.slice(5)); if (f) { companionCreds = undefined; askPin(f, "companion"); } }
      else if (action?.startsWith("retry:") && setup.phase === "failed") {
        const p = action.slice(6) as PairProtocol;
        if (p === "airplay" && companionCreds) askPin(setup.device, "airplay"); else { companionCreds = undefined; askPin(setup.device, "companion"); }
      }
  }
  return { view: renderSetup(setup, found, await paired(), typingAddress) };
}

export const cancelPairing = () => pairing?.cancel();
