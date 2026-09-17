// Colours: a picker (a view palette: the colour under the keys, every
// notation, tints, shades and harmonies, contrast, the nearest tokens,
// typing any notation, a screen pick), the named sets as a swatch grid
// with a filter per set, the history of picked and copied colours, and a
// converter that opens the picker on Enter. The maths is color.ts, the
// picker's state and moves state.ts, its tree render.ts, the sets sets.ts
// over data.json (build.ts). The picker's colour, model and the history
// live in storage, so Escape and restarts lose nothing.
import { color as screen, effects, settings, storage, type Effect, type Extension } from "@zcag/pal";
import { parse, toHex, type Format, type RGB } from "./color.ts";
import { render } from "./render.ts";
import { GRID_ACTIONS, HINTS, HISTORY_ACTIONS, PICK_ROW, conversions, detailOf, gridItem, hint, historyRows } from "./rows.ts";
import { SETS, SET_IDS, sectionOf, token, type Row, type SetId } from "./sets.ts";
import { DEFAULTS, apply, fresh, write, type Entry, type Settings, type Source, type State } from "./state.ts";
import data from "./data.json";

const NAME = "colors";
/** Notations the root's inline section shows of a typed colour (hex, rgb, hsl, hwb); the palette lists them all. */
const INLINE_ROWS = 4;
/** `[palettes.colors]`, default in pal.json. */
type PaletteSettings = { columns: number };

const rows = new Map<string, Row>((data as Row[]).map((r) => [r.id, r]));
const bySet = (id: SetId) => (data as Row[]).filter((r) => r.s === id);
const tokens = { tailwind: bySet("tailwind"), material: bySet("material") };
const rgbOf = (r: Row): RGB => parse(r.h)!;

const current = (): Settings => {
  const s = { ...DEFAULTS, ...settings.get<Partial<Settings>>(NAME) };
  s.sets = Array.isArray(s.sets) ? s.sets.filter((x): x is SetId => (SET_IDS as string[]).includes(x)) : DEFAULTS.sets;
  return s;
};

// ---- the state in storage ---------------------------------------------------------

const KEYS = { current: "current", model: "model", history: "history", recent: "recent" } as const;

/** In-process only: where the focus is and what is being typed; the rest is storage's. */
let ui: Pick<State, "focus" | "index" | "typing"> = { focus: "swatch", index: 0 };
/** A screen pick in flight: `view` waits for it, so the panel coming back draws the picked colour. */
let inflight: Promise<void> | null = null;

async function load(): Promise<State> {
  if (inflight) await inflight;
  return loadNow();
}
/** The stored state as it is, without waiting on a screen pick: what the pick's own task reads. */
async function loadNow(): Promise<State> {
  const [cur, model, history] = await Promise.all([storage.get<string>(KEYS.current, NAME), storage.get<string>(KEYS.model, NAME), storage.get<unknown>(KEYS.history, NAME)]);
  const st = fresh();
  const c = typeof cur === "string" ? parse(cur) : undefined;
  return { ...st, ...ui, color: c ?? st.color, model: model === "oklch" ? "oklch" : "hsl", history: Array.isArray(history) ? history.filter(isEntry) : [] };
}
const isEntry = (e: unknown): e is Entry => !!e && typeof e === "object" && typeof (e as Entry).c === "string" && typeof (e as Entry).at === "number" && typeof (e as Entry).from === "string";

/** Writes what changed since `before`, by identity or value, and keeps the in-process part. */
async function save(before: State, after: State) {
  ui = { focus: after.focus, index: after.index, typing: after.typing };
  const writes: Promise<unknown>[] = [];
  if (toHex(after.color) !== toHex(before.color)) writes.push(storage.set(KEYS.current, toHex(after.color), NAME));
  if (after.model !== before.model) writes.push(storage.set(KEYS.model, after.model, NAME));
  if (after.history !== before.history) writes.push(storage.set(KEYS.history, after.history, NAME));
  await Promise.all(writes);
}

/** A colour into the picker's state and the history, from outside the picker (a set tile, the converter, a screen pick). */
async function commit(c: RGB, from: Source, name?: string): Promise<State> {
  const s = current();
  const before = await load();
  const after = apply(before, { kind: "set", color: c, from, name, at: Date.now() }, s.history_size);
  await save(before, after);
  return after;
}

const view = (st: State) => render(st, current(), tokens);
const PICKER = { extension: NAME, palette: "picker" };

// The grid's Recent section: the last twelve tiles opened, in storage.
const RECENT = "Recent", RECENT_MAX = 12;
async function recent(): Promise<string[]> {
  const ids = await storage.get<unknown>(KEYS.recent, NAME);
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && rows.has(id)) : [];
}
const rememberRecent = async (id: string) => storage.set(KEYS.recent, [id, ...(await recent()).filter((x) => x !== id)].slice(0, RECENT_MAX), NAME);

// ---- screen picks ----------------------------------------------------------------------

/**
 * The sampler hides the panel and waits on the user, longer than a pick
 * may take, so the pick returns at once and the rest runs here: the
 * colour into the state and the history, then the panel back in the
 * picker (`then: "show"`), or the colour copied with the HUD saying so
 * (`then: "copy"`). A cancel brings the picker back unchanged, or says so.
 */
function sampleThen(then: "show" | "copy"): Effect {
  inflight = (async () => {
    let picked: RGB | undefined;
    try {
      const c = await screen.sample();
      picked = c ? parse(c.hex) : undefined;
    } catch (e) {
      console.log(`colors: screen pick failed: ${e instanceof Error ? e.message : e}`);
    }
    if (picked) {
      const s = current();
      const before = await loadNow();
      await save(before, apply(before, { kind: "set", color: picked, from: "screen", at: Date.now() }, s.history_size));
    }
    inflight = null;
    if (then === "show") await effects.run({ push: PICKER });
    else if (picked) { const text = write(picked, current()); await effects.run({ copy: text, hud: `Copied ${text}` }); }
    else await effects.run({ hud: "No colour picked" });
  })().catch((e) => { inflight = null; console.log(`colors: after the screen pick: ${e instanceof Error ? e.message : e}`); });
  return { hide: true };
}

// ---- the extension ------------------------------------------------------------------------------------

export default {
  palettes: {
    picker: {
      title: "Colour Picker",
      view: async (ctx) => {
        const args = ctx?.args as { color?: string; from?: Source; name?: string } | undefined;
        const c = args?.color ? parse(args.color) : undefined;
        return view(c ? await commit(c, args?.from ?? "picker", args?.name) : await load());
      },
      pick: async (_id, action, ctx): Promise<Effect> => {
        const s = current();
        const before = await load();
        const now = Date.now();
        const step = (axis: "h" | "s" | "l", n: number) => apply(before, { kind: "step", axis, steps: n }, s.history_size);
        let after = before;
        switch (action) {
          case "copy": case "copy:hex": case "copy:rgb": case "copy:hsl": case "copy:hwb": case "copy:oklch": case "copy:oklab": case "copy:lab": case "copy:p3": case "copy:name": {
            const f = action === "copy" ? s.format : (action.slice(5) as Format);
            after = apply(before, { kind: "copied", at: now }, s.history_size);
            await save(before, after);
            return { copy: write(before.color, s, f) };
          }
          case "pick": return sampleThen("show");
          case "history": return { push: { extension: NAME, palette: "history" } };
          case "names": return { push: { extension: NAME, palette: "colors" } };
          case "model": after = apply(before, { kind: "model" }, s.history_size); break;
          case "undo": after = apply(before, { kind: "undo" }, s.history_size); break;
          case "random": after = apply(before, { kind: "random", hue: Math.floor(Math.random() * 360), sat: 60 + Math.floor(Math.random() * 40), light: 40 + Math.floor(Math.random() * 25) }, s.history_size); break;
          case "focus:next": after = apply(before, { kind: "focus", dir: 1 }, s.history_size); break;
          case "focus:prev": after = apply(before, { kind: "focus", dir: -1 }, s.history_size); break;
          case "along:next": after = apply(before, { kind: "along", dir: 1 }, s.history_size); break;
          case "along:prev": after = apply(before, { kind: "along", dir: -1 }, s.history_size); break;
          case "use": after = apply(before, { kind: "use", at: now }, s.history_size); break;
          case "h+": after = step("h", 1); break;
          case "h-": after = step("h", -1); break;
          case "h++": after = step("h", 3); break;
          case "h--": after = step("h", -3); break;
          case "l+": after = step("l", 1); break;
          case "l-": after = step("l", -1); break;
          case "l++": after = step("l", 5); break;
          case "l--": after = step("l", -5); break;
          case "s+": after = step("s", 1); break;
          case "s-": after = step("s", -1); break;
          case "cancel": after = apply(before, { kind: "type" }, s.history_size); after = { ...after, typing: undefined }; break;
          case "apply": {
            const text = String((ctx?.values as { input?: unknown } | undefined)?.input ?? "").trim();
            after = apply(before, { kind: "apply", text, at: now }, s.history_size);
            if (after.typing !== undefined) return { view: view(after), toast: { title: "Not a colour", message: `${text} is none of hex, rgb(), hsl(), hwb(), oklch(), oklab(), lab(), color() or a CSS name`, style: "failure" } };
            break;
          }
          default:
            if (action?.startsWith("type:")) after = apply(before, { kind: "type", text: action.slice(5) }, s.history_size);
        }
        await save(before, after);
        return { view: view(after) };
      },
    },
    colors: {
      title: "Named Colours",
      view: "grid",
      // Palette meta is read once at load (see emoji).
      columns: settings.palette<PaletteSettings>("colors", NAME).columns,
      filters: [{ id: "all", title: "All sets" }, ...SETS.map((s) => ({ id: s.id, title: s.title }))],
      actions: GRID_ACTIONS,
      list: async (_q, ctx) => {
        const s = current();
        const filter = ctx?.filter && ctx.filter !== "all" ? (ctx.filter as SetId) : undefined;
        if (filter) return bySet(filter).map((r) => gridItem(r, sectionOf(r)));
        const used = await recent();
        const shown = (data as Row[]).filter((r) => s.sets.includes(r.s));
        return [...used.map((id) => gridItem(rows.get(id)!, RECENT)), ...shown.filter((r) => !used.includes(r.id)).map((r) => gridItem(r, sectionOf(r)))];
      },
      pick: async (id, action) => {
        const r = rows.get(id);
        if (!r) return { toast: { title: "Unknown colour", message: id, style: "failure" } };
        const s = current();
        await rememberRecent(id);
        const c = rgbOf(r);
        switch (action) {
          case "copy": await commit(c, "set", token(r)); return { copy: write(c, s) };
          case "hex": await commit(c, "set", token(r)); return { copy: write(c, s, "hex") };
          case "name": return { copy: token(r) };
          default: return { push: { extension: NAME, palette: "picker", args: { color: r.h, from: "set", name: token(r) } } };
        }
      },
      detail: (id) => { const r = rows.get(id); return r ? detailOf(rgbOf(r), r.n, current(), r) : undefined; },
    },
    history: {
      title: "Colour History",
      // Live: the rows change with every pick and copy, and a show relists them, so the root's rows are current.
      live: true,
      list: async () => historyRows(await load(), current(), Date.now()),
      actions: HISTORY_ACTIONS,
      pick: async (id, action) => {
        if (id === PICK_ROW) return action === "open" ? { push: PICKER } : sampleThen("copy");
        const s = current();
        const before = await load();
        const c = parse(id);
        if (!c) return { toast: { title: "Unknown colour", message: id, style: "failure" } };
        switch (action) {
          case "copy": return { copy: write(c, s) };
          case "hex": return { copy: write(c, s, "hex") };
          case "delete": await save(before, { ...before, history: before.history.filter((e) => e.c !== id) }); return { keep: true };
          case "clear": await save(before, apply(before, { kind: "clear" }, s.history_size)); return { keep: true };
          default: return { push: { extension: NAME, palette: "picker", args: { color: id, from: "history" } } };
        }
      },
      detail: (id) => { const c = parse(id); return c ? detailOf(c, id, current()) : undefined; },
    },
    convert: {
      title: "Convert Colour",
      input: true,
      // At the root a hex, an rgb()/hsl()/... notation or a CSS name answers inline: the first notations, Enter opens the picker on it.
      match: (q) => parse(q) !== undefined,
      inline: true,
      placeholder: "#ff8800, rgb(255 136 0), hsl(30 100% 50%), lab(), a name",
      list: (query = "", ctx) => {
        const q = query.trim();
        if (!q) return ctx?.inline ? [] : HINTS;
        const c = parse(q);
        if (ctx?.inline) return c ? conversions(c, current()).slice(0, INLINE_ROWS) : [];
        return c ? conversions(c, current()) : [hint("Not a colour", `${q} is none of hex, rgb(), hsl(), hwb(), oklch(), oklab(), lab(), color() or a CSS name`)];
      },
      pick: (id, action) => {
        if (id.startsWith("hint:")) return { keep: true };
        // The row is one notation of the typed colour and opens the picker on it; a contrast row is only a value to copy.
        const c = parse(id);
        if (action === "copy" || !c) return { copy: id };
        return { push: { extension: NAME, palette: "picker", args: { color: toHex(c), from: "convert" } } };
      },
    },
  },
} satisfies Extension;
