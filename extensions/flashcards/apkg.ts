// An Anki deck (.apkg) as a pack, so any deck from AnkiWeb works: drop the
// file in the packs folder. An .apkg is a zip of the collection (SQLite:
// `collection.anki2`/`.anki21`, or since Anki 2.1.50 `collection.anki21b`,
// zstd-compressed), a `media` index (JSON, or zstd-compressed protobuf in
// the new format) and the media files named 0, 1, 2… (zstd-compressed in
// the new format too).
//
// Each note is a card: its fields are matched by name (Front/Word/Spanish…
// for the front, Back/Meaning/English… for the back, a Sentence and its
// translation for the example), else the first two fields. HTML, cloze
// marks and [sound:] tags are stripped from the text; the first sound of
// the front (else of any field) is extracted beside the progress file and
// played on Tab, a native speaker over the system voice. A card's id is
// the note's guid, so progress survives a re-download of the deck.
import { Database } from "bun:sqlite";
import { unzipSync } from "fflate";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Card, Pack } from "./packs.ts";
import { all, fields, str } from "./pb.ts";

const ZSTD = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b: Uint8Array) => ZSTD.every((x, i) => b[i] === x);
const unzstd = (b: Uint8Array) => (isZstd(b) ? new Uint8Array(Bun.zstdDecompressSync(b)) : b);

/** The new `media` index: `MediaEntries { repeated MediaEntry entries = 1 }`, `MediaEntry { string name = 1 }`; an entry's place is its zip entry's name. */
const mediaNames = (buf: Uint8Array) => all(fields(buf), 1).map((e) => str(e, 1));

const clean = (s: string) => s
  .replace(/\[sound:[^\]]*\]/g, "")
  .replace(/\{\{c\d+::(.*?)(::[^}]*)?\}\}/g, "$1")
  .replace(/<br\s*\/?>|<\/div>|<\/p>/gi, " ")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, " ").trim();

// The sides first (a sentence deck's front is its "SpanishSentence"), then an example among what is left.
const ROLE: [keyof Card, RegExp][] = [
  ["front", /^(front|word|vocab|term|expression|target|question|spanish|french|german|italian|portuguese|japanese|korean|chinese|kanji|lemma)/i],
  ["back", /^(back|meaning|english|definition|translation|answer|gloss)/i],
  ["example_back", /(sentence|example).*(english|translation|meaning|back)|(english|translation).*(sentence|example)/i],
  ["example", /sentence|example|context/i],
  ["note", /^(note|notes|pos|part of speech|gender|hint|extra)/i],
];

/** Which field feeds which side, by the note type's field names; the first two fields when the names say nothing. */
export function roles(names: string[]): Partial<Record<keyof Card, number>> {
  const out: Partial<Record<keyof Card, number>> = {};
  // Bookkeeping fields are never a side: an id ("SpanishSentenceID"), a count, a difficulty, a sound or picture on its own.
  const used = new Set(names.flatMap((n, k) => (/(^|[\s_-])id$|[a-z]I[Dd]$|^(number|count|difficulty|rank|ranking|frequency|audio|sound|picture|image|tags?)\b|numberof/i.test(n) ? [k] : [])));
  for (const [role, re] of ROLE) {
    const i = names.findIndex((n, k) => !used.has(k) && re.test(n));
    if (i >= 0) { out[role] = i; used.add(i); }
  }
  const free = names.map((_, k) => k).filter((k) => !used.has(k));
  if (out.front === undefined) { out.front = free.shift() ?? 0; used.add(out.front); }
  if (out.back === undefined) { const k = free.find((x) => x !== out.front); out.back = k ?? 1; }
  return out;
}

type Model = { names: string[] };

const LANG: Record<string, string> = { spanish: "es", english: "en", french: "fr", german: "de", italian: "it", portuguese: "pt", turkish: "tr", japanese: "ja", dutch: "nl", korean: "ko", chinese: "zh", russian: "ru" };
/** A field named for a language ("Spanish", "English meaning") says which one its side is in. */
const langOf = (name?: string) => Object.entries(LANG).find(([n]) => name?.toLowerCase().includes(n))?.[1];

/** The .apkg at `path` as a pack; its sounds go under `mediaDir`. */
export async function readApkg(path: string, mediaDir: string): Promise<Pack> {
  const zip = unzipSync(new Uint8Array(await readFile(path)));
  const col = zip["collection.anki21b"] ? unzstd(zip["collection.anki21b"]) : zip["collection.anki21"] ?? zip["collection.anki2"];
  if (!col) throw new Error("not an Anki deck (no collection inside)");
  const tmp = join(mediaDir, `.collection-${process.pid}.sqlite`);
  await mkdir(mediaDir, { recursive: true });
  await writeFile(tmp, col);
  // Read-write: Anki writes the collection in WAL mode, which SQLite will not open read-only without its -shm file. It is a temp copy.
  const db = new Database(tmp);
  try {
    const tables = new Set((db.query("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name));
    const models = new Map<string, Model>();
    let deckName = "";
    if (tables.has("notetypes")) {
      for (const f of db.query("select ntid, ord, name from fields order by ntid, ord").all() as { ntid: number; ord: number; name: string }[]) {
        const m = models.get(String(f.ntid)) ?? { names: [] };
        m.names[f.ord] = f.name;
        models.set(String(f.ntid), m);
      }
      const top = db.query("select d.name as name, count(*) as n from cards c join decks d on d.id = c.did group by c.did order by n desc limit 1").get() as { name: string } | null;
      deckName = top?.name ?? "";
    } else {
      const row = db.query("select models, decks from col").get() as { models: string; decks: string };
      for (const [id, m] of Object.entries(JSON.parse(row.models) as Record<string, { flds: { name: string; ord: number }[] }>)) {
        models.set(id, { names: m.flds.sort((a, b) => a.ord - b.ord).map((f) => f.name) });
      }
      const decks = JSON.parse(row.decks) as Record<string, { name: string }>;
      const top = db.query("select did, count(*) as n from cards group by did order by n desc limit 1").get() as { did: number } | null;
      deckName = top ? decks[String(top.did)]?.name ?? "" : "";
    }
    // The deck's sounds: its index maps zip entry numbers to file names.
    const index = zip.media ? unzstd(zip.media) : undefined;
    let byName = new Map<string, string>();
    if (index) {
      if (index[0] === 0x7b) byName = new Map(Object.entries(JSON.parse(new TextDecoder().decode(index)) as Record<string, string>).map(([k, v]) => [v, k]));
      else mediaNames(index).forEach((n, i) => byName.set(n, String(i)));
    }
    const cards: Card[] = [];
    const wanted = new Map<string, string>();
    const langs = new Map<string, number>();
    for (const n of db.query("select guid, mid, flds from notes order by id").all() as { guid: string; mid: number; flds: string }[]) {
      const f = n.flds.split("\x1f");
      const names = models.get(String(n.mid))?.names ?? [];
      const r = roles(names);
      const lf = langOf(names[r.front!]), lb = langOf(names[r.back!]);
      if (lf || lb) langs.set(`${lf ?? ""}|${lb ?? ""}`, (langs.get(`${lf ?? ""}|${lb ?? ""}`) ?? 0) + 1);
      const pick = (k: keyof Card) => (r[k] !== undefined ? clean(f[r[k]!] ?? "") : "");
      const card: Card = { id: n.guid, front: pick("front"), back: pick("back") };
      for (const k of ["note", "example", "example_back"] as const) { const v = pick(k); if (v) card[k] = v; }
      if (!card.front || !card.back) continue;
      const sound = (f[r.front!] ?? "").match(/\[sound:([^\]]+)\]/)?.[1] ?? n.flds.match(/\[sound:([^\]]+)\]/)?.[1];
      if (sound && byName.has(sound)) { card.audio = join(mediaDir, basename(sound)); wanted.set(byName.get(sound)!, card.audio); }
      cards.push(card);
    }
    for (const [entry, out] of wanted) {
      const bytes = zip[entry];
      if (bytes) await writeFile(out, unzstd(bytes));
    }
    const id = basename(path, extname(path)).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    // The languages most notes' field names say, for the voice and the accent keys.
    // Else the deck's name ("Spanish (EN to ES) | 625 Words"): the language it names is the one learned, on the front.
    let [front, back]: (string | undefined)[] = [...langs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0].split("|") ?? [];
    if (!front && !back) front = langOf(deckName) ?? langOf(basename(path));
    return {
      id, title: deckName && deckName !== "Default" ? deckName.split("::").join(" › ") : basename(path, extname(path)),
      description: `An Anki deck: ${cards.length} cards`, cards, path,
      ...((front || back) && { lang: { ...(front && { front }), ...(back && { back }) } }),
    };
  } finally {
    db.close();
    await Promise.all(["", "-wal", "-shm"].map((x) => rm(tmp + x, { force: true })));
  }
}

/** Reads each deck once per change of its file: a big deck's media is written only then. */
const cache = new Map<string, { mtime: number; pack: Pack }>();
export async function readApkgCached(path: string, mediaRoot: string): Promise<Pack> {
  const { mtimeMs } = await stat(path);
  const hit = cache.get(path);
  if (hit?.mtime === mtimeMs) return hit.pack;
  const pack = await readApkg(path, join(mediaRoot, basename(path, extname(path))));
  cache.set(path, { mtime: mtimeMs, pack });
  return pack;
}
