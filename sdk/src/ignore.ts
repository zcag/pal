// Rows kept out of a list and its count until they change: a chat until its
// next message, a pull request until it is updated. Each hidden id keeps
// the stamp its row had when it was hidden (the newest message's id, an
// `updatedAt`); a row that comes back with another stamp is shown again and
// the entry goes. A `null` stamp never changes: hidden until shown again by
// hand (GitHub's mute). One storage key per store, loaded once; the
// extension's worker is its only writer.
import { storage } from "./api.ts";
import { now } from "./clock.ts";

export type IgnoreEntry = {
  /** The row's stamp when it was hidden; `null` until shown again by hand. */
  stamp: string | null;
  /** When a list last carried the row (unix ms); an entry no list has carried for `unseenMs` goes. */
  seen: number;
};

export type IgnoreRow = { id: string; stamp: string | null };

/** An entry no list has carried for this long goes, so the store does not collect every row ever hidden. */
export const IGNORE_UNSEEN_MS = 30 * 24 * 60 * 60 * 1000;
/** A seen time is written back only once it has moved a day: lists come every few minutes, the file need not. */
const SEEN_STEP_MS = 24 * 60 * 60 * 1000;

export type Ignored = {
  /** Loaded; every method below waits for it except the synchronous reads, which see nothing before it. */
  ready: Promise<void>;
  /** Whether a row carrying `stamp` stays out: kept with that very stamp, or kept with `null`. */
  hides(id: string, stamp: string | null | undefined): boolean;
  /** The entry, whatever the row's stamp is now. */
  get(id: string): IgnoreEntry | undefined;
  ids(): string[];
  add(rows: IgnoreRow[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /**
   * A fetched list's rows settle the store: an entry whose row carries
   * another stamp goes ("changed"), one `gone` names a reason for goes
   * with it (a merged pull request), one no list has carried for
   * `IGNORE_UNSEEN_MS` goes; the rest have their seen time moved up.
   * Returns what went, `[id, why]`.
   */
  settle(rows: IgnoreRow[], gone?: (id: string) => string | undefined): Promise<[string, string][]>;
};

/**
 * The store under `key` in the extension's storage. `migrate` reads an
 * older shape once, when the key is still empty, and its answer is saved
 * under `key` (GitHub's `muted` list becomes `null`-stamped entries).
 */
export function ignoreStore(key = "ignored", migrate?: () => Promise<Record<string, IgnoreEntry> | undefined>): Ignored {
  let entries: Record<string, IgnoreEntry> = {};
  const save = () => storage.set(key, entries);
  const ready = storage.get<Record<string, IgnoreEntry>>(key).then(async (v) => {
    if (v) { entries = v; return; }
    const old = await migrate?.();
    if (old) { entries = old; await save(); }
  }, () => {});
  return {
    ready,
    hides: (id, stamp) => { const e = entries[id]; return !!e && (e.stamp === null || e.stamp === (stamp ?? null)); },
    get: (id) => entries[id],
    ids: () => Object.keys(entries),
    async add(rows) {
      await ready;
      const t = now();
      for (const r of rows) entries[r.id] = { stamp: r.stamp, seen: t };
      await save();
    },
    async remove(ids) {
      await ready;
      let hit = false;
      for (const id of ids) if (entries[id]) { delete entries[id]; hit = true; }
      if (hit) await save();
    },
    async settle(rows, gone) {
      await ready;
      const t = now();
      const byId = new Map(rows.map((r) => [r.id, r]));
      const dropped: [string, string][] = [];
      let dirty = false;
      for (const [id, e] of Object.entries(entries)) {
        const r = byId.get(id);
        const why = gone?.(id);
        if (why) dropped.push([id, why]);
        else if (r && e.stamp !== null && r.stamp !== e.stamp) dropped.push([id, "changed"]);
        else if (r) { dirty ||= t - e.seen >= SEEN_STEP_MS; e.seen = t; }
        else if (t - e.seen > IGNORE_UNSEEN_MS) dropped.push([id, "unseen for 30 days"]);
      }
      for (const [id] of dropped) delete entries[id];
      if (dropped.length || dirty) await save();
      return dropped;
    },
  };
}
