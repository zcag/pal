// AnkiWeb's shared decks (ankiweb.net/shared/decks), the largest library of
// flashcard decks there is, over the service its own site uses: no account
// needed to search or download, as the Anki app does. Protobuf over GET
// (pb.ts); the message layouts are the site's bundle's (`list-decks` rows:
// id 1, title 2, thumbs up 3, down 4, mtime 5, notes 6, audio 7, images 8;
// `item-info`: available 1 → title 5, tags 6, size 7, last updated 8,
// description 9, deck 10 → notes 1, audio 2, images 3, sample notes 4
// (fields 1 → name 1, value 2), download key 5; thumbs up 18, down 19).
// `PAL_ANKIWEB_URL` points it elsewhere for tests.
import { all, fields, int, msg, str } from "./pb.ts";

const BASE = () => process.env.PAL_ANKIWEB_URL || "https://ankiweb.net";
export const pageOf = (id: number) => `https://ankiweb.net/shared/info/${id}`;

export type Deck = { id: number; title: string; up: number; down: number; updated: number; notes: number; audio: number; images: number };
export type Info = Deck & { description: string; tags: string; size: number; samples: { name: string; value: string }[][]; key: string };

async function get(path: string): Promise<Uint8Array> {
  const r = await fetch(`${BASE()}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (r.status === 429) throw new Error("AnkiWeb is asking to slow down; try again in a few minutes");
  if (!r.ok) throw new Error(`AnkiWeb answered ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const searches = new Map<string, { at: number; decks: Deck[] }>();
/** Shared decks matching `q`, as AnkiWeb ranks them; cached ten minutes. */
export async function search(q: string): Promise<Deck[]> {
  const key = q.trim().toLowerCase();
  const hit = searches.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.decks;
  const rows = all(fields(await get(`/svc/shared/list-decks?${new URLSearchParams({ search: key })}`)), 1);
  const decks = rows.map((r) => ({ id: int(r, 1), title: str(r, 2), up: int(r, 3), down: int(r, 4), updated: int(r, 5), notes: int(r, 6), audio: int(r, 7), images: int(r, 8) }));
  searches.set(key, { at: Date.now(), decks });
  return decks;
}

const infos = new Map<number, Info>();
/** One deck's page: its description, a few sample notes and the key its download needs. */
export async function info(id: number): Promise<Info> {
  const hit = infos.get(id);
  if (hit) return hit;
  const top = fields(await get(`/svc/shared/item-info?${new URLSearchParams({ sharedId: String(id) })}`));
  const a = msg(top, 1);
  if (!a.length) throw new Error("the deck is not shared any more");
  const deck = msg(a, 10);
  const i: Info = {
    id, title: str(a, 5), tags: str(a, 6).trim(), size: int(a, 7), updated: int(a, 8), description: str(a, 9),
    up: int(a, 18), down: int(a, 19), notes: int(deck, 1), audio: int(deck, 2), images: int(deck, 3),
    samples: all(deck, 4).map((n) => all(n, 1).map((f) => ({ name: str(f, 1), value: str(f, 2) }))),
    key: str(deck, 5),
  };
  infos.set(id, i);
  return i;
}

/** The deck's .apkg, fetched with a fresh key (they expire). */
export async function download(id: number): Promise<Uint8Array> {
  infos.delete(id);
  const { key } = await info(id);
  if (!key) throw new Error("AnkiWeb gave no download for this deck");
  const r = await fetch(`${BASE()}/svc/shared/download-deck/${id}?${new URLSearchParams({ t: key })}`, { signal: AbortSignal.timeout(600_000) });
  if (r.status === 429) throw new Error("AnkiWeb is limiting downloads; try again in a few minutes");
  if (!r.ok) throw new Error(`AnkiWeb answered ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
