// Packs: a titled set of cards. The bundled ones are JSON beside this file
// (packs/*.json, imported so the bundle carries them); yours are files in
// the packs folder, one pack per file:
//
//   *.json  { title, description?, lang?, reverse?, cards: [{ front, back, note?, example?, example_back?, id? }] }
//   *.apkg  an Anki deck, any from AnkiWeb (apkg.ts)
//   *.tsv, *.csv, *.txt  front, back, then optionally note, example,
//           example_back per line; a first line naming those columns is a
//           header. What Anki's "Notes in plain text" export writes (tabs,
//           `#` lines skipped, HTML stripped) reads as is.
//
// A card's id is stable across edits of its back: its own `id`, else its
// front. Progress is keyed by pack id and card id (store.ts), so fixing a
// typo in a translation keeps the card's history.
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { readApkgCached } from "./apkg.ts";

/** `weight`: the word's share of the language (how often it is heard), for "the words you know cover N%"; `example_source`/`source`: the credit a CC BY sentence needs. */
export type Card = { id: string; front: string; back: string; note?: string; example?: string; example_back?: string; weight?: number; example_source?: string; source?: string; /** A recording of the front (an Anki deck's own), played on Tab over the system voice. */ audio?: string };
/** `lang.front` / `lang.back`: BCP 47-ish codes ("es", "en") for speech; `reverse`: the pack also makes back → front cards. */
export type Pack = { id: string; title: string; description?: string; lang?: { front?: string; back?: string }; reverse?: boolean; source?: string; bundled?: boolean; path?: string; cards: Card[] };

const COLS = ["front", "back", "note", "example", "example_back"] as const;
const strip = (s: string) => s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();

/** One CSV line into fields: quotes, doubled quotes, commas inside quotes. */
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Rows of a tsv/csv/txt: tab-separated if any line has a tab, else comma-separated. */
export function parseTable(text: string): Card[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const tabs = lines.some((l) => l.includes("\t"));
  let rows = lines.map((l) => (tabs ? l.split("\t") : csvLine(l)).map(strip));
  let cols: readonly string[] = COLS;
  const head = rows[0]?.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  if (head && head.includes("front") && head.includes("back")) { cols = head; rows = rows.slice(1); }
  return rows.flatMap((r) => {
    const c = Object.fromEntries(cols.map((k, i) => [k, r[i] ?? ""]).filter(([, v]) => v)) as Partial<Card>;
    return c.front && c.back ? [{ ...c, id: c.id || c.front } as Card] : [];
  });
}

/** A pack file's cards and metadata; its id is the file name without the extension. */
export function parsePack(file: string, text: string): Pack {
  const id = basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  if (extname(file).toLowerCase() === ".json") {
    const j = JSON.parse(text) as Partial<Pack>;
    const cards = (Array.isArray(j.cards) ? j.cards : []).filter((c) => c && typeof c.front === "string" && typeof c.back === "string")
      .map((c) => ({ ...c, id: String(c.id ?? c.front) }));
    return { ...j, id, title: j.title || id, cards } as Pack;
  }
  return { id, title: basename(file, extname(file)), cards: parseTable(text) };
}

const EXT = new Set([".json", ".tsv", ".csv", ".txt", ".apkg"]);

/** Every pack file in `dir`, parsed; a file that fails to parse is reported, not fatal. An Anki deck's sounds go under `media`. */
export async function readFolder(dir: string, media = join(dir, ".media")): Promise<{ packs: Pack[]; errors: string[] }> {
  let names: string[] = [];
  try { names = await readdir(dir); } catch { return { packs: [], errors: [] }; }
  const packs: Pack[] = [], errors: string[] = [];
  for (const n of names.sort()) {
    if (n.startsWith(".") || !EXT.has(extname(n).toLowerCase())) continue;
    const path = join(dir, n);
    try {
      if (!(await stat(path)).isFile()) continue;
      const p = extname(n).toLowerCase() === ".apkg" ? await readApkgCached(path, media) : parsePack(n, await readFile(path, "utf8"));
      if (p.cards.length) packs.push({ ...p, path });
    } catch (e) { errors.push(`${n}: ${(e as Error).message}`); }
  }
  return { packs, errors };
}

/** Speech-synthesis language of a side, when the pack says. */
export const langOf = (p: Pack, side: "front" | "back") => p.lang?.[side];
