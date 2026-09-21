// States (docs/design/states.md): the palette that manages them and the
// bar item that shows what is held by hand. Every read and write is a
// `state.*` / `core/states.*` call; nothing is cached here, the core is
// the table.
import { argsForm, failed, hint, parseDuration, state, toast, type Accessory, type Action, type Arg, type BarItem, type Effect, type Extension, type Item, type StateEntry, type StateValue } from "@zcag/pal";

const GLYPH = "\u{f04f9}"; // 󰓹 nf-md-variable
const PLUS = "\u{f0415}";
const NEW = "new";

const NEW_ARGS: Arg[] = [
  { id: "name", placeholder: "Name: lowercase, digits, _", required: true },
  { id: "expr", placeholder: "Expression (optional): hour >= 9 and hour < 18" },
  { id: "default", placeholder: "Default (optional): true, 3, home" },
  { id: "description", placeholder: "Description (optional)" },
];
const SET_ARGS: Arg[] = [
  { id: "value", placeholder: "Value: true, false, 3, home", required: true },
  { id: "for", placeholder: "For: 15m, 1h, 3h, 1d (blank: until reset)" },
];

/** `true`, `3`, `"x"` as JSON; anything else the text. */
const parse = (s: string): StateValue => { try { const v = JSON.parse(s); return v === null || ["boolean", "number", "string"].includes(typeof v) ? v : s; } catch { return s; } };

/** `2 h 40 m`, `12 m`, `40 s`. */
export const left = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} m` : m ? `${m} m` : `${s} s`;
};

const sourceText = (e: StateEntry): string => (typeof e.source === "string" ? e.source : e.source.published === "builtin" ? "built-in" : e.source.published);

const valueTag = (v: StateValue): Accessory => v === null ? { tag: "unknown", color: "muted" } : v === true ? { tag: "true", color: "green" } : v === false ? { tag: "false", color: "muted" } : { tag: String(v), color: "blue" };

function row(e: StateEntry, now: number): Item {
  const manual = e.source === "manual";
  const subtitle = e.error ? `Error: ${e.error}` : e.description ?? (e.expr ? `= ${e.expr}` : e.builtin ? "Built-in" : manual ? "Set by hand" : `Published by ${sourceText(e)}`);
  const accessories: Accessory[] = [valueTag(e.value), { tag: manual ? (e.until ? `held · ${left(e.until - now)}` : "held") : sourceText(e), color: manual ? "amber" : e.error ? "red" : "muted" }];
  const boolean = typeof e.value === "boolean" || e.value === null;
  const actions: Action[] = e.builtin
    ? [{ id: "copy", title: "Copy name" }]
    : [
        ...(boolean ? [{ id: "toggle", title: e.value ? "Set false" : "Set true" }] : []),
        { id: "set", title: "Set a value for a while", args: true },
        { id: "hold-1h", title: "Set true for 1 hour" },
        { id: "hold-3h", title: "Set true for 3 hours" },
        { id: "hold-tomorrow", title: "Set true until tomorrow" },
        ...(manual ? [{ id: "reset", title: "Reset", shortcut: "cmd+r" }] : []),
        { id: "copy", title: "Copy name" },
        ...(e.declared ? [{ id: "undeclare", title: "Remove from config", shortcut: "cmd+backspace", style: "destructive" as const, confirm: `Remove [states.${e.name}] from the config file?` }] : []),
      ];
  return { id: e.name, name: e.name, subtitle, icon: GLYPH, keywords: ["state", e.name, sourceText(e)], accessories, args: SET_ARGS, actions };
}

const newRow: Item = { id: NEW, name: "New state", subtitle: "Declare one in the config: a name, an expression, a default", icon: PLUS, keywords: ["state", "new", "declare", "variable"], args: NEW_ARGS, actions: [{ id: "declare", title: "Declare", args: true }] };

async function list(_query?: string, ctx?: { filter?: string }): Promise<Item[]> {
  const all = await state.list();
  const now = Date.now();
  const f = ctx?.filter ?? "all";
  const rows = all.filter((e) => f === "all" || (f === "held" ? e.source === "manual" : f === "mine" ? !e.builtin && !e.name.includes("/") : f === "builtin" ? e.builtin : e.name.includes("/")));
  return [...(f === "all" || f === "mine" ? [newRow] : []), ...rows.map((e) => row(e, now)), ...(rows.length ? [] : [hint("none", "No states here", f === "held" ? "Set one by hand: a row's actions, or `pal state set working true --for 3h`" : "Declare one with New state, or `[states.<name>]` in the config")])];
}

/** Midnight tonight, local, as unix ms. */
const tomorrow = () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); };

async function pick(id: string, action?: string, ctx?: { values?: Record<string, string | boolean> }): Promise<Effect> {
  const v = ctx?.values;
  if (id === NEW) {
    if (!v) return { form: { ...argsForm(NEW_ARGS, "New state", { id: "declare", title: "Declare" }), id: NEW } };
    const name = String(v.name ?? "").trim();
    if (!/^[a-z0-9_]+$/.test(name)) return { form: { ...argsForm(NEW_ARGS, "New state", { id: "declare", title: "Declare" }, { name: "Lowercase letters, digits and _" }), id: NEW } };
    const expr = String(v.expr ?? "").trim(), description = String(v.description ?? "").trim(), def = String(v.default ?? "").trim();
    try { await state.declare(name, { ...(expr && { expr }), ...(description && { description }), ...(def && { default: parse(def) }) }); } catch (e) { return failed("declare the state", e); }
    return toast(`Declared ${name}`, "Written to [states] in the config file");
  }
  try {
    switch (action) {
      case "copy": return { copy: id };
      case "reset": await state.reset(id); return { keep: true };
      case "undeclare": await state.undeclare(id); return toast(`Removed [states.${id}]`);
      case "hold-1h": await state.hold(id, true, Date.now() + 3_600_000); return { keep: true };
      case "hold-3h": await state.hold(id, true, Date.now() + 3 * 3_600_000); return { keep: true };
      case "hold-tomorrow": await state.hold(id, true, tomorrow()); return { keep: true };
      case "set": {
        const raw = String(v?.value ?? "").trim();
        if (!raw) return { form: { ...argsForm(SET_ARGS, `Set ${id}`, { id: "set", title: "Set" }), id } };
        const forText = String(v?.for ?? "").trim();
        const secs = forText ? parseDuration(forText) : undefined;
        if (forText && secs === undefined) return { form: { ...argsForm(SET_ARGS, `Set ${id}`, { id: "set", title: "Set" }, { for: "90s, 25m, 1h30m, 2h, 1d" }), id } };
        await state.hold(id, parse(raw), secs ? Date.now() + secs * 1000 : undefined);
        return { keep: true };
      }
      default: {
        // Enter: a boolean flips; a typed value in the bar sets.
        const raw = String(v?.value ?? "").trim();
        if (raw) return pick(id, "set", ctx);
        const cur = await state.get(id);
        await state.hold(id, !(cur === true));
        return { keep: true };
      }
    }
  } catch (e) {
    return failed(`${action ?? "set"} ${id}`, e);
  }
}

async function render(): Promise<BarItem> {
  const held = (await state.list()).filter((e) => e.source === "manual");
  const empty = { icon: GLYPH, tooltip: "No state held by hand", menu: { palette: "states" } };
  if (!held.length) return { hidden: true, empty };
  const now = Date.now();
  held.sort((a, b) => (a.until ?? Infinity) - (b.until ?? Infinity));
  const first = held[0];
  const title = `${first.name}${first.until ? ` · ${left(first.until - now)}` : ""}`;
  const tooltip = held.map((e) => `${e.name} = ${JSON.stringify(e.value)}${e.until ? ` (${left(e.until - now)})` : ""}`).join(", ");
  return { icon: GLYPH, title, color: "amber", tooltip: `Held by hand: ${tooltip}`, ...(held.length > 1 && { badge: held.length }), menu: { palette: "states" }, refresh: first.until ? Math.max(10, Math.min(60, Math.round((first.until - now) / 1000))) : undefined };
}

export default {
  palettes: {
    states: {
      title: "States",
      live: true,
      placeholder: "Find a state, or type a value and press Enter on one",
      filters: [{ id: "all", title: "All" }, { id: "held", title: "Held by hand" }, { id: "mine", title: "Mine" }, { id: "ext", title: "From extensions" }, { id: "builtin", title: "Built-in" }],
      list,
      pick,
    },
  },
  bar: {
    forced: { render },
  },
} satisfies Extension;
