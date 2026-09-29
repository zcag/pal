// A multi pick (`ctx.ids`, `Action.multi`) answered by the single pick it
// already has: one pick per id, in order, their effects folded into the one
// effect the pick answers with. Every url opened, every copy on its own
// line, the first toast with the count, `keep` when any kept; the first
// failure instead, when one failed.
import type { Effect } from "./protocol.ts";

/**
 * The effects of one pick per marked row as one. `noun` names the rows in
 * the toast's message ("3 notifications"); without it the first toast's
 * message stays as it was. A lone effect is returned as it is.
 */
export function foldEffects(all: Effect[], noun?: string): Effect {
  if (all.length === 1) return all[0]!;
  const bad = all.find((e) => e.toast?.style === "failure");
  if (bad) return bad;
  const open = all.flatMap((e) => (e.open === undefined ? [] : Array.isArray(e.open) ? e.open : [e.open]));
  const copy = all.flatMap((e) => (typeof e.copy === "string" ? [e.copy] : []));
  const t = all.find((e) => e.toast)?.toast, hud = all.find((e) => e.hud)?.hud;
  return {
    ...(open.length ? { open } : {}),
    ...(copy.length ? { copy: copy.join("\n") } : {}),
    ...(t ? { toast: noun ? { ...t, message: `${all.length} ${noun}` } : t } : hud ? { hud: `${hud} and ${all.length - 1} more` } : {}),
    ...(all.some((e) => e.keep) ? { keep: true } : {}),
  };
}

/**
 * `one` for each id in turn (not in parallel: an API's rate limit and a
 * shared cache see one pick at a time), folded by `foldEffects`. One id is
 * its own pick, unchanged. The idiom:
 * `pick: (id, action, ctx) => eachId(ctx?.ids ?? [id], (x) => pickOne(x, action), "notifications")`.
 */
export async function eachId(ids: string[], one: (id: string) => Effect | void | Promise<Effect | void>, noun?: string): Promise<Effect> {
  const all: Effect[] = [];
  for (const id of ids) all.push((await one(id)) ?? {});
  return all.length ? foldEffects(all, noun) : {};
}
