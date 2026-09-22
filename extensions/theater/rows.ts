// What every module's palettes share: the hint rows a failed listing
// turns into (the setting to fill, a refused key, a service that does not
// answer), the guard that keeps a listing from throwing, the wait an
// input palette puts between the last keystroke and its request, and
// the small row helpers.
import { errorMessage, hint, type Effect, type Item } from "@zcag/pal";
import { ApiError, GLYPH, SetupError, log, needsSetup, service, settingsLink, type ServiceId } from "./http.ts";

/** The one row a service you have not set up gets: Enter opens Settings on its first empty field. */
export const setupRow = (id: ServiceId, e = needsSetup(id)!): Item =>
  hint(`setup:${id}`, `Set up ${service(id).title}`, e.which === "url" ? "Its URL under Settings › Extensions › Theater" : e.which === "key" ? "Its API key under Settings › Extensions › Theater" : "Its user and password under Settings › Extensions › Theater", { icon: GLYPH.key, actions: [{ id: "settings", title: "Open settings" }], section: "Set up" });

/** What a failed listing shows instead of rows, each naming the fix. */
export function failure(e: unknown): Item[] {
  if (e instanceof SetupError) return [setupRow(e.service, e)];
  if (e instanceof ApiError && e.unauthorized) return [hint(`setup:${e.service}`, `${service(e.service).title} rejected the key`, "Check it under Settings › Extensions › Theater", { icon: GLYPH.alert, actions: [{ id: "settings", title: "Open settings" }] })];
  const name = e instanceof ApiError ? service(e.service).title : "The service";
  log(errorMessage(e));
  return [hint("error", `${name} did not answer`, `${errorMessage(e)}; cmd+r tries again`, { icon: GLYPH.alert })];
}

/** Rows or the failure hint, never a thrown listing. */
export const guard = async (f: () => Promise<Item[]>): Promise<Item[]> => { try { return await f(); } catch (e) { return failure(e); } };

/** The pick of a hint row: Settings on the service's row. */
export function pickHint(id: string): Effect | void {
  const m = /^hint:setup:(\w+)$/.exec(id);
  if (m) { const s = m[1] as ServiceId; return { open: settingsLink(s, needsSetup(s)?.which ?? "key") }; }
}

/**
 * The wait between the last keystroke and the request (the panel lists
 * an input palette on every keystroke and never debounces): one per
 * query, restarted by a newer query only; a call for the query already
 * waiting joins it, a call a newer query overtook answers that query's
 * rows once they land (the panel has moved on and drops the reply).
 */
export function debounced(ms: number, load: (q: string) => Promise<Item[]>): (q: string) => Promise<Item[]> {
  let seq = 0;
  let newest: { q: string; rows: Promise<Item[]>; done: boolean } | undefined;
  return (q: string) => {
    if (newest?.q === q && !newest.done) return newest.rows;
    const mine = ++seq;
    const entry = { q, done: false, rows: Bun.sleep(ms).then(() => (mine === seq ? load(q) : newest!.rows)) };
    entry.rows.then(() => { entry.done = true; }, () => { entry.done = true; });
    newest = entry;
    return entry.rows;
  };
}
export const SEARCH_WAIT_MS = 300;

/** A `{ date }` accessory from an ISO string or unix seconds, or nothing. */
export const dateOf = (t?: string | number | null) => (t ? [{ date: typeof t === "number" ? t * 1000 : t }] : []);
export const str = (v: unknown) => (typeof v === "string" ? v : "");
