// Where a palette is described (docs/extensions.md, "Where a palette is
// described"): `pal.json` holds the static, author-facing facts (title,
// description, kind, ttl, keys, rank, settings), the code the behaviour
// (`list`/`pick`/`detail`/`view`, the flags). The two overlap on purpose in
// one place, `kind`, which the manifest states and the code implies, and
// by tolerance in four more, `title`, `ttl`, `tier` and `lazy`, where the manifest wins.
// `checkPalettes` is what the host runs on every load to merge the two into
// the palette metas it sends the core and to say where they disagree; an
// extension's own tests can run it too (`checkPalettes(manifest, ext)`).
// The typed `defineExtension(manifest, ext)` (index.ts) is the same rule at
// type level: `ExtensionFor<M>` names the palettes the manifest declares.
import { badged, checkIcon, TILE_COLORS, type TileColor } from "./icon.ts";
import type { Extension, LinkParams, ListPalette, Manifest, ManifestLink, ManifestPalette, OwnIcon, Palette, PaletteKind, PaletteMeta, ViewPalette, ViewTrigger } from "./protocol.ts";

/** A palette whose `view` is a function draws a tree instead of listing rows. */
export const isViewPalette = (p: Palette): p is ViewPalette => typeof p.view === "function";

export const PALETTE_KINDS: readonly PaletteKind[] = ["list", "live", "input", "grid", "view"];
/** What may re-ask an open view (`Palette.on`). */
export const VIEW_TRIGGERS: readonly ViewTrigger[] = ["media", "wake", "network", "show"];

/**
 * The kind the code implies, first match wins: `view` for a `view()`
 * palette, `grid` for `view: "grid"`, `input` for `input: true`, `live`
 * for `live: true` (without `input`: a live input palette is `input`),
 * else `list`.
 */
export function kindOf(p: Palette): PaletteKind {
  if (isViewPalette(p)) return "view";
  if (p.view === "grid") return "grid";
  if (p.input) return "input";
  if (p.live) return "live";
  return "list";
}

/** How the code spells each kind, for a warning that names the fix. */
const SPELLING: Record<PaletteKind, string> = {
  view: "a view() palette",
  grid: 'view: "grid"',
  input: "input: true",
  live: "live: true",
  list: "a plain list (neither live, input, grid nor view)",
};

// ---- instances (docs/design/instances.md) ----------------------------------

/**
 * What the metas of one instance of a `multi` extension need: the
 * instance's `title` ("Work"; none for an unnamed default), whether it is
 * `alone` (the only instance of its extension), and for a non-default one
 * the `tint` and `badge` its tile wears.
 */
export type InstanceMeta = { title?: string; alone: boolean; tint?: TileColor; badge?: string };

/** `{instance}` in a manifest title; `PLACEHOLDER_FRAMED` takes one surrounding pair of parentheses or one flanking space with it. */
const PLACEHOLDER = /\{instance\}/;
const PLACEHOLDER_FRAMED = /\s*\(\{instance\}\)|\s\{instance\}|\{instance\}\s|\{instance\}/;

/**
 * A palette's title as one instance shows it. With two or more instances
 * of the extension and a title for this one: `{instance}` in the title is
 * the instance's title (`"{instance} Inbox"` is "Work Inbox"), else it is
 * appended in parentheses ("Inbox (Work)"). Alone, or for a default the
 * user has not named: `{instance}` is stripped with one surrounding pair
 * of parentheses or one flanking space ("Inbox ({instance})" is "Inbox"),
 * and nothing is appended. So the root section, the crumb, the Settings
 * rows and the bar popover title all read the same string.
 */
export function instanceTitle(title: string, inst?: InstanceMeta): string {
  const t = inst?.title?.trim();
  if (!inst || inst.alone || !t) return stripInstance(title);
  if (PLACEHOLDER.test(title)) return title.replace(/\{instance\}/g, t);
  return `${title} (${t})`;
}

/** `title` without its `{instance}` and the space or parentheses that framed it. */
export const stripInstance = (title: string): string => title.replace(PLACEHOLDER_FRAMED, "").trim() || title;

/**
 * One palette's meta, the manifest's entry merged over the code's: `title`
 * and `ttl` from the manifest when it has them (the code's as a fallback,
 * the key when neither has a title); everything else is the code's. The
 * icon is the code's own when it has one, else `fallbackIcon`, the
 * extension's icon from the manifest: an extension's palettes wear its
 * tile unless one says otherwise. For an instance (`inst`) the title
 * follows `instanceTitle` and a tile icon is `badged` with the instance's
 * mark (the extension's tile takes its tint too; a palette's own tile
 * keeps its colour and gains the badge). A view palette is `input` on the
 * wire: the core indexes nothing of it and the root keeps only its own
 * row, which is what `input` already means.
 */
export function paletteMeta(name: string, p: Palette, m?: ManifestPalette, fallbackIcon?: OwnIcon, inst?: InstanceMeta): PaletteMeta {
  const own = p.icon !== undefined;
  const icon = inst ? badged(own ? p.icon : fallbackIcon, own ? { badge: inst.badge } : inst) : (p.icon ?? fallbackIcon);
  return {
    name,
    title: inst ? instanceTitle(m?.title ?? p.title ?? name, inst) : (m?.title ?? p.title ?? name),
    live: !!p.live,
    input: !!p.input || isViewPalette(p),
    icon,
    view: isViewPalette(p) ? "view" : p.view,
    columns: p.columns,
    placeholder: p.placeholder,
    showDetail: p.showDetail,
    filters: p.filters,
    actions: p.actions,
    detail: typeof p.detail === "function" ? "lazy" : undefined,
    ttl: m?.ttl ?? p.ttl,
    tier: m?.tier ?? p.tier,
    ...((m?.lazy ?? p.lazy) && { lazy: true as const }),
    ...(isViewPalette(p) && (m?.refresh ?? p.refresh) !== undefined && { refresh: m?.refresh ?? p.refresh }),
    ...(isViewPalette(p) && (m?.on ?? p.on)?.length && { on: m?.on ?? p.on }),
    ...(inlineOf(p, m) && { inline: true as const }),
    ...(matchSource(p, m) !== undefined && { match: matchSource(p, m) }),
    ...(fallbackOf(p, m)),
    ...(typeof p.suggest === "function" && { suggest: true as const }),
    ...(p.multi === true && { multi: true as const }),
  };
}

/** Whether the palette lists inline at the root: `inline` on either side, and a `match` to gate it (a palette that matches everything would run on every keystroke). */
const inlineOf = (p: Palette, m?: ManifestPalette) => !!(p.inline ?? m?.inline) && (p.match !== undefined || m?.match !== undefined);

/** The regex source the meta carries for the store: the code's string or regex, else the manifest's (which, next to a predicate in the code, only documents it). */
function matchSource(p: Palette, m?: ManifestPalette): string | undefined {
  if (p.match instanceof RegExp) return p.match.source;
  if (typeof p.match === "string") return p.match;
  return m?.match;
}

/** The meta's `fallback`/`fallbackTitle` for what the code and the manifest declare (the code's function first, then either side's ask form). */
function fallbackOf(p: Palette, m?: ManifestPalette): Pick<PaletteMeta, "fallback" | "fallbackTitle"> {
  if (typeof p.fallback === "function") return { fallback: "rows" };
  const f = p.fallback ?? m?.fallback;
  if (f === true) return { fallback: "ask" };
  if (typeof f === "string" && f.trim()) return { fallback: "ask", fallbackTitle: f };
  return {};
}

/** The regex a palette's `match` names, compiled once per source (the manifest's string form when the code has none). */
const compiled = new Map<string, RegExp | null>();
function regexOf(source: string): RegExp | null {
  let r = compiled.get(source);
  if (r === undefined) {
    try { r = new RegExp(source, "i"); } catch { r = null; }
    compiled.set(source, r);
  }
  return r;
}

/**
 * Whether the root query `q` is one this palette answers inline: the
 * code's predicate, else its regex (or string, or the manifest's string)
 * against the query. Never for an empty query, never for a palette that
 * is not `inline`. A regex that does not compile matches nothing.
 */
export function inlineMatches(p: Palette, m: ManifestPalette | undefined, q: string): boolean {
  if (!inlineOf(p, m) || !q.trim()) return false;
  if (typeof p.match === "function") { try { return !!p.match(q); } catch { return false; } }
  if (p.match instanceof RegExp) return p.match.test(q);
  const source = typeof p.match === "string" ? p.match : m?.match;
  return source !== undefined && !!regexOf(source)?.test(q);
}

/** What `checkPalettes` answers: the metas to serve, and every disagreement as one line (`palettes.<key>: ...`). */
export type PaletteCheck = { metas: PaletteMeta[]; warnings: string[] };

/**
 * The manifest's `palettes` against the code's, one warning per
 * disagreement, none when they agree:
 *
 * - a code palette the manifest lacks is served anyway, its meta from the
 *   code alone (a warning names the entry to add);
 * - a manifest palette the code lacks is not served (nothing could answer
 *   it) and warned about;
 * - `kind` stated in the manifest must be the kind the code implies
 *   (`kindOf`); the warning says how the code spells the manifest's kind
 *   and what to set;
 * - `title`, `ttl`, `tier`, `lazy`, `refresh` and `on` set on both sides
 *   must agree; the manifest's is served either way. `refresh` and `on`
 *   mean nothing on a palette that lists, and are warned about there;
 * - the manifest's `icon` and every palette's `icon` are well formed
 *   (`checkIcon`, icon.ts): a tile names a brand colour and carries one
 *   glyph or a short SVG path. A bad palette icon is dropped from its meta;
 *   a palette without one takes the manifest's (`paletteMeta`).
 *
 * A manifest without a `palettes` key at all declares nothing static (the
 * bundled `scripts` discovers its palettes from a config file), so every
 * code palette is served from the code without a word. One that has the
 * key, even empty, must name them all.
 *
 * `inst` (an instance of a `multi` extension) puts the instance's title
 * and mark on every meta (`paletteMeta`); a tint that is not a brand
 * colour is a warning and the extension's own colour stays. `{instance}`
 * in a title of a manifest that does not declare `multi` is a warning,
 * since nothing will ever fill it.
 */
export function checkPalettes(manifest: Manifest, ext: Extension, inst?: InstanceMeta): PaletteCheck {
  const warnings: string[] = [];
  const declared = manifest.palettes;
  const metas: PaletteMeta[] = [];
  const manifestIcon = checkIcon(manifest.icon, "icon");
  if (manifestIcon) warnings.push(manifestIcon);
  if (inst?.tint !== undefined && !TILE_COLORS.includes(inst.tint)) warnings.push(`instance tint "${String(inst.tint)}" is not one of ${TILE_COLORS.join(", ")}; the extension's own colour is kept`);
  const mark = inst && { ...inst, tint: inst.tint !== undefined && TILE_COLORS.includes(inst.tint) ? inst.tint : undefined };
  for (const [name, p] of Object.entries(ext.palettes ?? {})) {
    const m = declared?.[name];
    const kind = kindOf(p);
    const badIcon = checkIcon(p.icon, `palettes.${name}`);
    if (badIcon) warnings.push(badIcon);
    if (declared && !m) {
      warnings.push(`palettes.${name}: in the code but not in pal.json; add "${name}": { "kind": "${kind}" } to its "palettes"`);
    } else if (m) {
      if (m.kind !== undefined && !PALETTE_KINDS.includes(m.kind)) {
        warnings.push(`palettes.${name}: kind "${m.kind}" is not one of ${PALETTE_KINDS.join(", ")}; the code is ${SPELLING[kind]}, set "kind": "${kind}"`);
      } else if (m.kind !== undefined && m.kind !== kind) {
        warnings.push(`palettes.${name}: kind "${m.kind}" in pal.json but the code is ${SPELLING[kind]}; set "kind": "${kind}", or make the code ${SPELLING[m.kind]}`);
      }
      if (m.title !== undefined && p.title !== undefined && m.title !== p.title) {
        warnings.push(`palettes.${name}: title "${p.title}" in the code, "${m.title}" in pal.json; the manifest's is used, drop the code's`);
      }
      if (m.ttl !== undefined && p.ttl !== undefined && m.ttl !== p.ttl) {
        warnings.push(`palettes.${name}: ttl ${p.ttl} in the code, ${m.ttl} in pal.json; the manifest's is used, drop the code's`);
      }
      if (m.tier !== undefined && p.tier !== undefined && m.tier !== p.tier) {
        warnings.push(`palettes.${name}: tier "${p.tier}" in the code, "${m.tier}" in pal.json; the manifest's is used, drop the code's`);
      }
      if (m.lazy !== undefined && p.lazy !== undefined && m.lazy !== p.lazy) {
        warnings.push(`palettes.${name}: lazy ${p.lazy} in the code, ${m.lazy} in pal.json; the manifest's is used, drop the code's`);
      }
      if (m.refresh !== undefined && p.refresh !== undefined && m.refresh !== p.refresh) {
        warnings.push(`palettes.${name}: refresh ${p.refresh} in the code, ${m.refresh} in pal.json; the manifest's is used, drop the code's`);
      }
      if (m.on !== undefined && p.on !== undefined && JSON.stringify(m.on) !== JSON.stringify(p.on)) {
        warnings.push(`palettes.${name}: on ${JSON.stringify(p.on)} in the code, ${JSON.stringify(m.on)} in pal.json; the manifest's is used, drop the code's`);
      }
    }
    if (kind !== "view" && (m?.refresh ?? p.refresh) !== undefined) warnings.push(`palettes.${name}: refresh is for a view palette (a re-ask of view(ctx) while it is open); a listing has ttl and live`);
    if (kind !== "view" && (m?.on ?? p.on) !== undefined) warnings.push(`palettes.${name}: on is for a view palette (the triggers that re-ask view(ctx) while it is open)`);
    const on = m?.on ?? p.on;
    if (on !== undefined && (!Array.isArray(on) || !on.every((t) => VIEW_TRIGGERS.includes(t)))) warnings.push(`palettes.${name}: on must be a list of ${VIEW_TRIGGERS.join(", ")}`);
    if (!manifest.multi && PLACEHOLDER.test(m?.title ?? p.title ?? "")) warnings.push(`palettes.${name}: the title uses {instance} but pal.json does not declare "multi": true; nothing fills it`);
    metas.push(paletteMeta(name, badIcon ? { ...p, icon: undefined } : p, m, manifestIcon ? undefined : manifest.icon, mark));
  }
  for (const name of Object.keys(declared ?? {})) {
    if (!(name in (ext.palettes ?? {}))) warnings.push(`palettes.${name}: in pal.json but not in the code; nothing serves it`);
  }
  return { metas, warnings };
}

// ---- links (pal://<extension>/<route>) --------------------------------------

/** A route name as a link path part: lowercase, digits, `-`. */
const ROUTE_NAME = /^[a-z0-9][a-z0-9-]*$/;
export const LINK_PARAM_TYPES = ["string", "number", "boolean", "json", "string[]"] as const;

/**
 * The manifest's `links` against the code's `link`, one warning per
 * disagreement (`links.<route>: ...`), none when they agree, run on every
 * load like `checkPalettes`: a `links` block with no `link` function
 * (nothing could answer them), a `link` function with no `links` block
 * (nothing can reach it: a route is served only when declared), a route
 * name a link path cannot carry, a param `type` not in
 * `LINK_PARAM_TYPES`. The routes are the manifest's either way; a warned
 * route is still listed, since the settings window shows the warning next
 * to it.
 */
export function checkLinks(manifest: Manifest, ext: Extension): string[] {
  const warnings: string[] = [];
  const links = manifest.links;
  const declared = Object.keys(links ?? {});
  if (links !== undefined && (typeof links !== "object" || Array.isArray(links))) return [`links: not an object of routes`];
  if (declared.length && typeof ext.link !== "function") warnings.push(`links: ${declared.length === 1 ? "a route is" : `${declared.length} routes are`} declared in pal.json but the code exports no link(route, params); nothing answers ${declared.map((r) => `"${r}"`).join(", ")}`);
  if (!declared.length && typeof ext.link === "function") warnings.push(`links: the code exports link(route, params) but pal.json declares no "links"; a route is reachable only when declared`);
  for (const [route, spec] of Object.entries(links ?? {})) {
    if (!ROUTE_NAME.test(route)) warnings.push(`links.${route}: a route is lowercase letters, digits and "-" (pal://${manifest.name}/${route} cannot be typed)`);
    if (!spec || typeof spec !== "object") { warnings.push(`links.${route}: not an object`); continue; }
    for (const [name, p] of Object.entries(spec.params ?? {})) {
      if (!p || typeof p !== "object") warnings.push(`links.${route}: param "${name}" is not an object`);
      else if (p.type !== undefined && !(LINK_PARAM_TYPES as readonly string[]).includes(p.type)) warnings.push(`links.${route}: param "${name}" has type "${p.type}", not one of ${LINK_PARAM_TYPES.join(", ")}`);
    }
  }
  return warnings;
}

const TRUE = new Set(["1", "true", "yes", "on"]);

/**
 * The query string's values (each a string, or an array of strings for a
 * repeated key) as `link` receives them, by the route's declared params:
 * a required one missing throws naming it, `number` parses (NaN throws),
 * `boolean` reads `1 true yes on`, `json` parses, `string[]` wraps a
 * single value; an undeclared key rides through as it came, so a route
 * that takes free-form params still gets them. Throws with the route and
 * the reason.
 */
export function checkLinkParams(spec: ManifestLink, raw: Record<string, unknown>, where: string): LinkParams {
  const out: LinkParams = { ...raw };
  for (const [name, p] of Object.entries(spec.params ?? {})) {
    const v = raw[name];
    const first = Array.isArray(v) ? v[0] : v;
    if (first === undefined || first === "") {
      if (p.required) throw new Error(`${where}: ${name} is required`);
      delete out[name];
      continue;
    }
    switch (p.type ?? "string") {
      case "string": out[name] = String(first); break;
      case "number": { const n = Number(first); if (Number.isNaN(n)) throw new Error(`${where}: ${name} must be a number, not "${first}"`); out[name] = n; break; }
      case "boolean": out[name] = TRUE.has(String(first).trim().toLowerCase()); break;
      case "json": { try { out[name] = JSON.parse(String(first)); } catch (e) { throw new Error(`${where}: ${name} is not JSON: ${e instanceof Error ? e.message : e}`); } break; }
      case "string[]": out[name] = (Array.isArray(v) ? v : [v]).map(String); break;
    }
  }
  return out;
}

/** What a `link` may answer: a pick's effects minus the ones that need the level a pick came from (the same set `effects.run` refuses). */
export const LINK_EFFECT_REFUSED = ["keep", "show", "view", "form"] as const;

/** The effect a `link` answered, refused when it carries one of `LINK_EFFECT_REFUSED`; returns it untouched. */
export function checkLinkEffect<T>(r: T, where: string): T {
  if (r && typeof r === "object") {
    const k = LINK_EFFECT_REFUSED.find((k) => (r as Record<string, unknown>)[k] !== undefined);
    if (k) throw new Error(`${where}: a link cannot answer \`${k}\`; that needs the level a pick came from (answer push, copy, paste, open, hud, toast, ...)`);
  }
  return r;
}

// ---- the same rule at type level ------------------------------------------

/**
 * What the type-level check reads of a manifest: the palette keys and their
 * `kind`. Looser than `Manifest` on purpose, since a JSON import widens
 * every string literal (`kind: string`) and would not satisfy it.
 */
export type ManifestLike = { palettes?: Record<string, { kind?: string }>; [key: string]: unknown };

/** The palette keys a manifest declares, as a union; `string` when it has no `palettes` key (dynamic). */
export type PaletteKeys<M extends ManifestLike> = M["palettes"] extends Record<infer K, unknown> ? K & string : string;

/**
 * The shape a palette must have for a manifest `kind`: a `view()` palette
 * for `view`, `view: "grid"` for `grid`, `input: true` for `input`,
 * `live: true` for `live`, none of those for `list`. A kind the type does
 * not pin down (a JSON import widens it to `string`, or it is absent)
 * allows any palette; `checkPalettes` still checks it at load.
 */
export type PaletteFor<K> =
  K extends "view" ? ViewPalette
  : K extends "grid" ? ListPalette & { view: "grid" }
  : K extends "input" ? ListPalette & { input: true }
  : K extends "live" ? ListPalette & { live: true; input?: false }
  : K extends "list" ? ListPalette & { live?: false; input?: false; view?: "list" }
  : Palette;

/**
 * An `Extension` whose palettes are the ones manifest `M` declares, each of
 * the shape its `kind` asks for. `defineExtension(manifest, ext)` (index.ts)
 * checks an extension against it where it is written: a declared palette
 * left out, one the manifest does not know, or a `live` one written as
 * `input` is a type error, not a load warning.
 */
export type ExtensionFor<M extends ManifestLike> = Omit<Extension, "palettes"> & {
  palettes: M["palettes"] extends Record<string, { kind?: string }> ? { [K in PaletteKeys<M>]: PaletteFor<M["palettes"][K]["kind"]> } : Record<string, Palette>;
};
