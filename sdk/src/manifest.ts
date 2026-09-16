// Where a palette is described (docs/extensions.md, "Where a palette is
// described"): `pal.json` holds the static, author-facing facts (title,
// description, kind, ttl, keys, rank, settings), the code the behaviour
// (`list`/`pick`/`detail`/`view`, the flags). The two overlap on purpose in
// one place, `kind`, which the manifest states and the code implies, and
// by tolerance in three more, `title`, `ttl` and `tier`, where the manifest wins.
// `checkPalettes` is what the host runs on every load to merge the two into
// the palette metas it sends the core and to say where they disagree; an
// extension's own tests can run it too (`checkPalettes(manifest, ext)`).
// The typed `defineExtension(manifest, ext)` (index.ts) is the same rule at
// type level: `ExtensionFor<M>` names the palettes the manifest declares.
import type { Extension, ListPalette, Manifest, ManifestPalette, Palette, PaletteKind, PaletteMeta, ViewPalette } from "./protocol.ts";

/** A palette whose `view` is a function draws a tree instead of listing rows. */
export const isViewPalette = (p: Palette): p is ViewPalette => typeof p.view === "function";

export const PALETTE_KINDS: readonly PaletteKind[] = ["list", "live", "input", "grid", "view"];

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

/**
 * One palette's meta, the manifest's entry merged over the code's: `title`
 * and `ttl` from the manifest when it has them (the code's as a fallback,
 * the key when neither has a title); everything else is the code's. A view
 * palette is `input` on the wire: the core indexes nothing of it and the
 * root keeps only its own row, which is what `input` already means.
 */
export function paletteMeta(name: string, p: Palette, m?: ManifestPalette): PaletteMeta {
  return {
    name,
    title: m?.title ?? p.title ?? name,
    live: !!p.live,
    input: !!p.input || isViewPalette(p),
    icon: p.icon,
    view: isViewPalette(p) ? "view" : p.view,
    columns: p.columns,
    placeholder: p.placeholder,
    showDetail: p.showDetail,
    filters: p.filters,
    actions: p.actions,
    detail: typeof p.detail === "function" ? "lazy" : undefined,
    ttl: m?.ttl ?? p.ttl,
    tier: m?.tier ?? p.tier,
  };
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
 * - `title` and `ttl` set on both sides must agree; the manifest's is
 *   served either way.
 *
 * A manifest without a `palettes` key at all declares nothing static (the
 * bundled `scripts` discovers its palettes from a config file), so every
 * code palette is served from the code without a word. One that has the
 * key, even empty, must name them all.
 */
export function checkPalettes(manifest: Manifest, ext: Extension): PaletteCheck {
  const warnings: string[] = [];
  const declared = manifest.palettes;
  const metas: PaletteMeta[] = [];
  for (const [name, p] of Object.entries(ext.palettes ?? {})) {
    const m = declared?.[name];
    const kind = kindOf(p);
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
    }
    metas.push(paletteMeta(name, p, m));
  }
  for (const name of Object.keys(declared ?? {})) {
    if (!(name in (ext.palettes ?? {}))) warnings.push(`palettes.${name}: in pal.json but not in the code; nothing serves it`);
  }
  return { metas, warnings };
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
