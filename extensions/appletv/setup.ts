// The setup as a render tree, pure (the fixture and the tests draw rigged
// states with it). Four steps along the top, the one in progress lit:
// Find (the Apple TVs on the network, a digit pairs one), Remote (the
// Companion pairing: the PIN the TV shows, typed in the search row's
// field, for the buttons, apps, typing and power), Now playing (the
// AirPlay pairing, a second PIN, for what plays, the artwork and seeking;
// it can be skipped) and Ready (a check of what works, read from the TV
// itself, with the next steps). A small drawing of the TV's own pairing
// screen says where to look for the code.
import { column, keyHint, keycap, row, text, type Action, type View, type ViewNode } from "@zcag/pal";
import { G } from "./remote.ts";
import type { Found, PairProtocol, Paired } from "./types.ts";

export type Check = { ok: boolean | "skipped"; what: string; detail: string };

export type SetupState =
  | { phase: "find"; scanning: boolean; error?: string }
  /** A PIN is (being put) on the TV: `asking` until the TV confirmed it shows one. */
  | { phase: "pin"; protocol: PairProtocol; device: Found; asking: boolean; error?: string; tries: number }
  /** Both pairings done (or the second skipped): connecting and reading what works. */
  | { phase: "checking"; device: Found }
  | { phase: "ready"; device: Paired; checks: Check[] }
  | { phase: "failed"; device: Found; protocol?: PairProtocol; error: string; hint?: string };

const STEPS = ["Find", "Remote", "Now playing", "Ready"] as const;

function stepOf(st: SetupState): number {
  if (st.phase === "find") return 0;
  if (st.phase === "pin") return st.protocol === "companion" ? 1 : 2;
  if (st.phase === "failed") return st.protocol === "airplay" ? 2 : 1;
  return 3;
}

/** The steps as a row of numbered pills: done ones checked, the current one in the accent. */
function stepper(st: SetupState): ViewNode {
  const at = stepOf(st);
  const kids: ViewNode[] = [];
  STEPS.forEach((s, i) => {
    if (i) kids.push({ type: "stack", key: `rule-${i}`, width: 24, height: 1, surface: "sunken", children: [] });
    const done = i < at || (st.phase === "ready" && i === 3);
    kids.push(row([
      { type: "tile", key: `n-${i}-${done ? "done" : i === at ? "now" : "next"}`, width: 20, height: 20, text: done ? "✓" : String(i + 1), color: done ? "green" : i === at ? "accent" : "neutral", fill: done || i === at ? "solid" : "outline", transition: { enter: "pop", exit: "none" } },
      text(s, { size: "xs", weight: i === at ? "semibold" : "regular", color: i === at ? undefined : "muted" }),
    ], { key: `step-${i}`, gap: 1 }));
  });
  return row(kids, { key: "steps", gap: 2 });
}

/** A small drawing of the TV showing its pairing code: where to look. */
function tvDrawing(name: string, protocol: PairProtocol, asking: boolean): ViewNode {
  const boxes = [0, 1, 2, 3].map((i): ViewNode => ({ type: "tile", key: `pin-${i}`, width: 22, height: 26, text: asking ? "" : "•", color: "#FFFFFF", fill: "outline" }));
  return column([
    // The bezel: an elevated frame, so the black screen stands out on the dark panel too.
    { type: "stack", key: "bezel", surface: "elevated", radius: true, padding: 1, children: [{ type: "stack", key: "screen", width: 220, height: 124, surface: "#0B0B0D", radius: true, direction: "column", align: "center", justify: "center", gap: 2, children: [
      text(protocol === "companion" ? "Remote Pairing" : "AirPlay Pairing", { size: "xs", weight: "semibold", color: "faint" }),
      row(boxes, { key: "boxes", gap: 1, justify: "center" }),
      text(asking ? "waiting for the code…" : "enter this code on pal", { size: "xs", color: "faint" }),
    ] }] },
    { type: "stack", key: "stand", width: 60, height: 6, surface: "sunken", radius: true, children: [] },
    text(name, { size: "xs", color: "muted" }),
  ], { key: "tv", gap: 1, align: "center" });
}

const WHAT: Record<PairProtocol, { title: string; why: string }> = {
  companion: { title: "Type the code on your TV", why: "This pairs the remote: the buttons and swipes, opening apps, typing into the TV, sleep and wake." },
  airplay: { title: "One more code", why: "This one shows what is playing, with the artwork, and lets the position bar seek. Skip it if the remote is all you want." },
};

/** Every action the setup answers to in this state; the first listed is Enter. */
export function actions(st: SetupState, found: Found[], paired: Paired[]): Action[] {
  switch (st.phase) {
    case "find": {
      const acts: Action[] = found.slice(0, 9).map((f, i) => ({ id: `pair:${f.id}`, title: `${paired.some((p) => p.id === f.id) ? "Pair again with" : "Pair with"} ${f.name}`, shortcut: i === 0 ? ["enter", "1"] : String(i + 1), ...(i > 0 && { hidden: true as const }) }));
      acts.push({ id: "rescan", title: "Look again", shortcut: "r" }, { id: "type", title: "Type an address", shortcut: "i" });
      if (paired.length) acts.push({ id: "remote", title: "Open the remote", shortcut: "o" }, { id: "forget", title: `Forget ${paired.length === 1 ? paired[0].name : "an Apple TV"}`, shortcut: "x", style: "destructive", confirm: `Forget ${paired[paired.length - 1].name}? It also leaves the Apple TV's list of remotes once you remove pal there (Settings › Remotes and Devices).` });
      acts.push({ id: "pair:typed", title: "Pair with the typed address", hidden: true, shortcut: "enter" }, { id: "type:cancel", title: "Stop typing", hidden: true, shortcut: "escape" });
      return acts;
    }
    case "pin": {
      const acts: Action[] = [{ id: "pin", title: "Send the code", hidden: true, shortcut: "enter" }, { id: "pin:again", title: "Show a new code", shortcut: "n" }, { id: "back", title: "Back to the list", shortcut: "escape" }];
      if (st.protocol === "airplay") acts.splice(1, 0, { id: "skip", title: "Skip: the remote alone", shortcut: "s" });
      return acts;
    }
    case "checking": return [];
    case "ready": return [{ id: "remote", title: "Open the remote" }, { id: "apps", title: "Browse the apps", shortcut: "a" }, { id: "bar", title: "Show it on the menu bar", shortcut: "b" }, { id: "back", title: "Pair another Apple TV", shortcut: "p" }];
    case "failed": return [{ id: `retry:${st.protocol ?? "companion"}`, title: "Try again" }, { id: "back", title: "Back to the list", shortcut: "b" }];
  }
}

function findBody(st: Extract<SetupState, { phase: "find" }>, found: Found[], paired: Paired[]): ViewNode[] {
  const kids: ViewNode[] = [
    text(found.length ? "Pick your Apple TV" : st.scanning ? "Looking for Apple TVs" : "No Apple TV found", { style: "headline", key: `h-${found.length ? "pick" : st.scanning ? "look" : "none"}`, transition: { enter: "fade" } }),
    text(found.length ? "The Apple TVs on this network. Turn the TV on, then press its digit: a code appears on the screen." : st.scanning ? "Asking the network; this takes a few seconds." : "Is it on, and on the same network as this Mac? On the Apple TV, Settings › AirPlay and HomeKit › Allow Access should not be set to Only People Sharing This Home. You can also type its address.", { style: "muted", size: "sm" }),
  ];
  if (st.error) kids.push(text(st.error, { size: "sm", color: "destructive" }));
  if (found.length) {
    kids.push(column(found.slice(0, 9).map((f, i) => {
      const done = paired.some((p) => p.id === f.id);
      return row([
        keycap(String(i + 1), `pair:${f.id}`),
        text(G.tv, { style: "glyph", size: "md", color: "muted" }),
        column([text(f.name, { size: "sm", weight: "semibold", width: 220 }), text(f.modelName, { size: "xs", color: "muted", width: 220 })], { gap: 0 }),
        text(f.address, { style: "mono", size: "xs", width: 120 }),
        text(f.os ? `tvOS ${f.os}` : "", { size: "xs", color: "faint", width: 80 }),
        { type: "spacer" },
        ...(f.asleep ? [{ type: "badge", text: "asleep", color: "grey" } as ViewNode] : []),
        ...(done ? [{ type: "badge", text: "paired", color: "green" } as ViewNode] : []),
      ], { key: `found-${f.id}`, gap: 2, minHeight: 36, action: `pair:${f.id}`, transition: { enter: "slide-up", delay: Math.min(8, i) } });
    }), { key: "found", gap: 1, padding: 2, surface: "elevated", radius: true }));
  } else if (st.scanning) {
    kids.push({ type: "progress", key: "scan", value: 0.4, width: 200 });
  }
  kids.push(row([...(found.length ? keyHint("1-9", "pair") : []), ...keyHint("r", "look again"), ...keyHint("i", "type an address"), ...(paired.length ? [...keyHint("o", "remote"), ...keyHint("x", "forget")] : [])], { key: "keys", gap: 1 }));
  return kids;
}

function pinBody(st: Extract<SetupState, { phase: "pin" }>): ViewNode[] {
  const w = WHAT[st.protocol];
  return [row([
    column([
      text(w.title, { style: "headline", key: `h-${st.protocol}`, transition: { enter: "fade" } }),
      text(st.asking ? `Asking ${st.device.name} to show a code…` : `${st.device.name} shows a four-digit code. Type it in the field above and press Enter.`, { size: "sm" }),
      text(w.why, { style: "muted", size: "sm" }),
      ...(st.error ? [text(st.error, { size: "sm", color: "destructive", key: `err-${st.tries}`, transition: { enter: "fade" } })] : []),
      row([...keyHint("enter", "send"), ...keyHint("n", "new code"), ...(st.protocol === "airplay" ? keyHint("s", "skip") : []), ...keyHint("escape", "back")], { key: "keys", gap: 1 }),
    ], { key: "pin-text", gap: 2, width: 400 }),
    { type: "spacer" },
    tvDrawing(st.device.name, st.protocol, st.asking),
  ], { key: "pin", gap: 6, align: "center" })];
}

function readyBody(st: Extract<SetupState, { phase: "ready" }>): ViewNode[] {
  return [
    text(`${st.device.name} is ready`, { style: "headline", color: "success", key: "h-ready", transition: { enter: "pop" } }),
    text(`${st.device.modelName} · ${st.device.address}`, { style: "muted", size: "sm" }),
    column(st.checks.map((c, i) => row([
      text(c.ok === true ? G.check : c.ok === "skipped" ? G.info : G.alert, { style: "glyph", size: "md", color: c.ok === true ? "green" : c.ok === "skipped" ? "muted" : "amber" }),
      text(c.what, { size: "sm", weight: "semibold", width: 120 }),
      text(c.detail, { size: "sm", color: "muted", width: 460 }),
    ], { key: `check-${i}`, gap: 2, minHeight: 22, transition: { enter: "slide-up", delay: Math.min(8, i) } })), { key: "checks", gap: 1, padding: 2, surface: "elevated", radius: true }),
    row([...keyHint("enter", "open the remote"), ...keyHint("a", "apps"), ...keyHint("b", "menu bar item"), ...keyHint("p", "pair another")], { key: "keys", gap: 1 }),
  ];
}

export function render(st: SetupState, found: Found[], paired: Paired[], typing?: string): View {
  let body: ViewNode[];
  if (st.phase === "find") body = findBody(st, found, paired);
  else if (st.phase === "pin") body = pinBody(st);
  else if (st.phase === "checking") body = [text(`Connecting to ${st.device.name}`, { style: "headline" }), text("Reading what it can do: the apps, the volume, what is playing.", { style: "muted", size: "sm" }), { type: "progress", key: "check", value: 0.6, width: 240 }];
  else if (st.phase === "ready") body = readyBody(st);
  else body = [
    text("Not paired", { style: "headline", color: "destructive" }),
    text(`${st.device.name} · ${st.device.address}`, { style: "muted", size: "sm" }),
    text(st.error, { size: "sm" }),
    ...(st.hint ? [text(st.hint, { style: "muted", size: "sm" })] : []),
    row([...keyHint("enter", "try again"), ...keyHint("b", "back")], { key: "keys", gap: 1 }),
  ];
  const view: View = { tree: column([stepper(st), ...body, { type: "spacer", key: "fill" }], { key: "setup", padding: 4, gap: 3, grow: true }), actions: actions(st, found, paired), title: "Set up Apple TV", id: "setup", keys: "actions" };
  if (st.phase === "pin" && !st.asking) view.input = { value: "", placeholder: `The code on ${st.device.name}`, submit: "pin", cancel: "back" };
  else if (st.phase === "find" && typing !== undefined) view.input = { value: typing, placeholder: "192.168.1.40", submit: "pair:typed", cancel: "type:cancel" };
  return view;
}
