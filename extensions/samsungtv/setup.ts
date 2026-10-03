// The setup as a render tree, pure (the fixture and the tests draw rigged
// states with it). Three steps along the top, the one in progress lit:
// Find (the TVs on the network, a digit pairs one, or an address typed),
// Allow (the TV asks "Allow pal?" on its screen; a small drawing of that
// prompt says where to look, and the wait counts down) and Ready (a check
// of what works, read from the TV itself, with the next steps).
import { column, keyHint, keycap, row, text, type Action, type View, type ViewNode } from "@zcag/pal";
import { G } from "./remote.ts";
import type { Found, Paired } from "./types.ts";

export type Check = { ok: boolean | "skipped"; what: string; detail: string };

export type SetupState =
  | { phase: "find"; scanning: boolean; error?: string }
  /** The TV shows its Allow prompt; `until` is when it gives up (unix ms). */
  | { phase: "allow"; device: Found; until: number }
  /** Allowed: connecting and reading what works. */
  | { phase: "checking"; device: Found }
  | { phase: "ready"; device: Paired; checks: Check[] }
  | { phase: "failed"; device: Found; error: string; hint?: string };

const STEPS = ["Find", "Allow", "Ready"] as const;

function stepOf(st: SetupState): number {
  if (st.phase === "find") return 0;
  if (st.phase === "allow" || st.phase === "failed") return 1;
  return 2;
}

/** The steps as a row of numbered pills: done ones checked, the current one in the accent. */
function stepper(st: SetupState): ViewNode {
  const at = stepOf(st);
  const kids: ViewNode[] = [];
  STEPS.forEach((s, i) => {
    if (i) kids.push({ type: "stack", key: `rule-${i}`, width: 24, height: 1, surface: "sunken", children: [] });
    const done = i < at || (st.phase === "ready" && i === 2);
    kids.push(row([
      { type: "tile", key: `n-${i}-${done ? "done" : i === at ? "now" : "next"}`, width: 20, height: 20, text: done ? "✓" : String(i + 1), color: done ? "green" : i === at ? "accent" : "neutral", fill: done || i === at ? "solid" : "outline", transition: { enter: "pop", exit: "none" } },
      text(s, { size: "xs", weight: i === at ? "semibold" : "regular", color: i === at ? undefined : "muted" }),
    ], { key: `step-${i}`, gap: 1 }));
  });
  return row(kids, { key: "steps", gap: 2 });
}

/** A small drawing of the TV showing its Allow prompt: where to look and what to press. */
function tvDrawing(name: string): ViewNode {
  const btn = (label: string, on: boolean): ViewNode => ({ type: "tile", key: `btn-${label}`, width: 58, height: 18, text: label, color: on ? "#1428A0" : "#3A3A42", fill: "solid" });
  return column([
    { type: "stack", key: "bezel", surface: "elevated", radius: true, padding: 1, children: [{ type: "stack", key: "screen", width: 240, height: 132, surface: "#0B0B0D", radius: true, direction: "column", align: "center", justify: "end", padding: 2, children: [
      { type: "stack", key: "dialog", width: 180, surface: "#1C1C22", radius: true, direction: "column", align: "center", gap: 1, padding: 2, children: [
        text("Allow pal to connect?", { size: "xs", weight: "semibold", color: "faint" }),
        row([btn("Allow", true), btn("Deny", false)], { key: "btns", gap: 2, justify: "center" }),
      ] },
    ] }] },
    { type: "stack", key: "stand", width: 80, height: 5, surface: "sunken", radius: true, children: [] },
    text(name, { size: "xs", color: "muted" }),
  ], { key: "tv", gap: 1, align: "center" });
}

/** Every action the setup answers to in this state; the first listed is Enter. */
export function actions(st: SetupState, found: Found[], paired: Paired[]): Action[] {
  switch (st.phase) {
    case "find": {
      const acts: Action[] = found.slice(0, 9).map((f, i) => ({ id: `pair:${f.id}`, title: `${paired.some((p) => p.id === f.id) ? "Pair again with" : "Pair with"} ${f.name}`, shortcut: i === 0 ? ["enter", "1"] : String(i + 1), ...(i > 0 && { hidden: true as const }) }));
      acts.push({ id: "rescan", title: "Look again", shortcut: "r" }, { id: "type", title: "Type an address", shortcut: "i" });
      if (paired.length) acts.push({ id: "remote", title: "Open the remote", shortcut: "o" }, { id: "forget", title: `Forget ${paired[paired.length - 1].name}`, shortcut: "x", style: "destructive", confirm: `Forget ${paired[paired.length - 1].name}? To remove pal on the TV too: Settings › General › External Device Manager › Device Connection Manager › Device List.` });
      acts.push({ id: "pair:typed", title: "Pair with the typed address", hidden: true, shortcut: "enter" }, { id: "type:cancel", title: "Stop typing", hidden: true, shortcut: "escape" });
      return acts;
    }
    case "allow": return [{ id: "back", title: "Cancel", shortcut: "escape" }];
    case "checking": return [];
    case "ready": return [{ id: "remote", title: "Open the remote" }, { id: "apps", title: "Browse the apps", shortcut: "a" }, { id: "bar", title: "Show it on the menu bar", shortcut: "b" }, { id: "back", title: "Pair another TV", shortcut: "p" }];
    case "failed": return [{ id: "retry", title: "Try again" }, { id: "back", title: "Back to the list", shortcut: "b" }];
  }
}

function findBody(st: Extract<SetupState, { phase: "find" }>, found: Found[], paired: Paired[]): ViewNode[] {
  const kids: ViewNode[] = [
    text(found.length ? "Pick your TV" : st.scanning ? "Looking for Samsung TVs" : "No Samsung TV found", { style: "headline", key: `h-${found.length ? "pick" : st.scanning ? "look" : "none"}`, transition: { enter: "fade" } }),
    text(found.length ? "The Samsung TVs on this network. Turn the TV on, then press its digit: the TV asks whether to allow pal." : st.scanning ? "Asking the network; this takes a few seconds." : "Is it on, and on the same network as this computer? Smart TVs from 2016 on are found here; you can also type its address (the TV shows it under Settings › General › Network › Network Status).", { style: "muted", size: "sm" }),
  ];
  if (st.error) kids.push(text(st.error, { size: "sm", color: "destructive" }));
  if (found.length) {
    kids.push(column(found.slice(0, 9).map((f, i) => {
      const done = paired.some((p) => p.id === f.id);
      return row([
        keycap(String(i + 1), `pair:${f.id}`),
        text(G.tv, { style: "glyph", size: "md", color: "muted" }),
        column([text(f.name, { size: "sm", weight: "semibold", width: 220 }), text(f.model, { size: "xs", color: "muted", width: 220 })], { gap: 0 }),
        text(f.address, { style: "mono", size: "xs", width: 120 }),
        { type: "spacer" },
        ...(f.power === "standby" ? [{ type: "badge", text: "standby", color: "grey" } as ViewNode] : []),
        ...(done ? [{ type: "badge", text: "paired", color: "green" } as ViewNode] : []),
      ], { key: `found-${f.id}`, gap: 2, minHeight: 36, action: `pair:${f.id}`, transition: { enter: "slide-up", delay: Math.min(8, i) } });
    }), { key: "found", gap: 1, padding: 2, surface: "elevated", radius: true }));
  } else if (st.scanning) {
    kids.push({ type: "progress", key: "scan", value: 0.4, width: 200 });
  }
  kids.push(row([...(found.length ? keyHint("1-9", "pair") : []), ...keyHint("r", "look again"), ...keyHint("i", "type an address"), ...(paired.length ? [...keyHint("o", "remote"), ...keyHint("x", "forget")] : [])], { key: "keys", gap: 1 }));
  return kids;
}

function allowBody(st: Extract<SetupState, { phase: "allow" }>, now: number): ViewNode[] {
  const left = Math.max(0, Math.round((st.until - now) / 1000));
  return [row([
    column([
      text("Press Allow on your TV", { style: "headline", key: "h-allow", transition: { enter: "fade" } }),
      text(`${st.device.name} asks whether to allow pal. Choose Allow with its remote.`, { size: "sm" }),
      text("This lets pal press its buttons, open its apps, type into it and set its volume. The TV keeps the answer: it does not ask again.", { style: "muted", size: "sm" }),
      row([{ type: "progress", key: "wait", value: Math.min(1, left / 35), width: 160 }, text(`${left} s`, { style: "mono", size: "xs", key: `left-${left}` })], { key: "wait-row", gap: 2 }),
      row(keyHint("escape", "cancel"), { key: "keys", gap: 1 }),
    ], { key: "allow-text", gap: 2, width: 380 }),
    { type: "spacer" },
    tvDrawing(st.device.name),
  ], { key: "allow", gap: 6, align: "center" })];
}

function readyBody(st: Extract<SetupState, { phase: "ready" }>): ViewNode[] {
  return [
    text(`${st.device.name} is ready`, { style: "headline", color: "success", key: "h-ready", transition: { enter: "pop" } }),
    text(`${st.device.model} · ${st.device.address}`, { style: "muted", size: "sm" }),
    column(st.checks.map((c, i) => row([
      text(c.ok === true ? G.check : c.ok === "skipped" ? G.info : G.alert, { style: "glyph", size: "md", color: c.ok === true ? "green" : c.ok === "skipped" ? "muted" : "amber" }),
      text(c.what, { size: "sm", weight: "semibold", width: 120 }),
      text(c.detail, { size: "sm", color: "muted", width: 460 }),
    ], { key: `check-${i}`, gap: 2, minHeight: 22, transition: { enter: "slide-up", delay: Math.min(8, i) } })), { key: "checks", gap: 1, padding: 2, surface: "elevated", radius: true }),
    row([...keyHint("enter", "open the remote"), ...keyHint("a", "apps"), ...keyHint("b", "menu bar item"), ...keyHint("p", "pair another")], { key: "keys", gap: 1 }),
  ];
}

export function render(st: SetupState, found: Found[], paired: Paired[], typing?: string, now = Date.now()): View {
  let body: ViewNode[];
  if (st.phase === "find") body = findBody(st, found, paired);
  else if (st.phase === "allow") body = allowBody(st, now);
  else if (st.phase === "checking") body = [text(`Connecting to ${st.device.name}`, { style: "headline" }), text("Reading what it can do: the apps, the volume, what is on.", { style: "muted", size: "sm" }), { type: "progress", key: "check", value: 0.6, width: 240 }];
  else if (st.phase === "ready") body = readyBody(st);
  else body = [
    text("Not paired", { style: "headline", color: "destructive" }),
    text(`${st.device.name} · ${st.device.address}`, { style: "muted", size: "sm" }),
    text(st.error, { size: "sm" }),
    ...(st.hint ? [text(st.hint, { style: "muted", size: "sm" })] : []),
    row([...keyHint("enter", "try again"), ...keyHint("b", "back")], { key: "keys", gap: 1 }),
  ];
  const view: View = { tree: column([stepper(st), ...body, { type: "spacer", key: "fill" }], { key: "setup", padding: 4, gap: 3, grow: true }), actions: actions(st, found, paired), title: "Set up Samsung TV", id: "setup", keys: "actions" };
  if (st.phase === "find" && typing !== undefined) view.input = { value: typing, placeholder: "192.168.1.31", submit: "pair:typed", cancel: "type:cancel" };
  return view;
}
