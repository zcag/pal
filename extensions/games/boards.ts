// The Leaderboards view: one game's boards (`leaderboards` in its pal.json),
// reached from the game's row (cmd+L) or from the root's Leaderboards row,
// which opens on the first game that has any (`g` walks the others).
//
// A tab per board the game declares. A board with a `*` in its id (a
// board per puzzle: Wordle #259, a sudoku daily) has as many tabs as the
// server lists for the game, newest first; that list is pal's server's
// `GET /api/boards/<game>`, the one call made here rather than through
// the core, since it carries no player. A board that is the same thing
// all along (a best score) has the period switch: all time, this week,
// today. Hide anonymous is remembered (`hide_anon`). The viewer's own row
// is ringed, and below the top when they are not in it; signed out, a row
// offers to sign in.
//
// Boards come over the network, so the view never waits on them: it draws
// what it has (a board read under a minute ago, else "Loading"), asks for
// the rest, and pushes the tree again when it lands (`view.update`).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { account, column, errorMessage, extensions, keyHint, leaderboardOf, leaderboard, row, storage, text, view, type Action, type Effect, type Leaderboard, type LeaderboardRow, type LeaderboardSpec, type Manifest, type View, type ViewNode } from "@zcag/pal";

export const PALETTE = "leaderboards";
type Period = "all" | "week" | "day";
const PERIODS: { id: Period; title: string }[] = [{ id: "all", title: "All time" }, { id: "week", title: "This week" }, { id: "day", title: "Today" }];
/** How long a board read is shown without asking again. */
const FRESH_MS = 60_000;
/** Tabs a `*` board gets at most: its newest. */
const STAR_TABS = 6;
/** Rows drawn; the server answers fifty. */
const SHOWN = 25;

/** A game that has boards: its title, the palette Play opens, the declared boards. */
export type BoardGame = { extension: string; title: string; palette: string; boards: LeaderboardSpec[] };
/** A tab: a posted board id (`daily/259`) and its title, from the declaration it falls under. */
export type Tab = { id: string; title: string; spec: LeaderboardSpec };

/** The server the boards list is read from (`PAL_ACCOUNT_API` overrides it, as for the core). */
const api = () => (process.env.PAL_ACCOUNT_API || "https://pal.cagdas.io").replace(/\/+$/, "");

/** The installed, loaded games with boards, by title: the first view palette of each is what Play opens. */
export async function boardGames(): Promise<BoardGame[]> {
  const found = await Promise.all((await extensions.list()).filter((e) => e.loaded && e.name !== "games").map(async (e): Promise<BoardGame[]> => {
    try {
      const m = JSON.parse(await readFile(join(e.root, e.name, "pal.json"), "utf8")) as Manifest & { store?: { category?: string } };
      const palette = Object.entries(m.palettes ?? {}).find(([, p]) => p.kind === "view")?.[0];
      if (m.store?.category !== "fun" || !palette || !Array.isArray(m.leaderboards) || !m.leaderboards.length) return [];
      return [{ extension: e.name, title: m.title ?? e.name, palette, boards: m.leaderboards }];
    } catch { return []; }
  }));
  return found.flat().sort((a, b) => a.title.localeCompare(b.title));
}

/** The tabs: each plain board, and for a `*` one the listed boards it covers, newest first. */
export function tabsOf(g: BoardGame, listed: string[]): Tab[] {
  const m = { name: g.extension, title: g.title, leaderboards: g.boards } as Manifest;
  return g.boards.flatMap((spec) => {
    if (!spec.id.split("/").includes("*")) return [{ id: spec.id, title: spec.title, spec }];
    return listed.filter((id) => leaderboardOf(m, id)?.id === spec.id)
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
      .slice(0, STAR_TABS)
      .map((id) => ({ id, title: leaderboardOf(m, id)!.title, spec }));
  });
}

/** A value as its board shows it: points with separators, a time as `1:01.20` (seconds in), moves as they are. */
export function formatValue(v: number, format: LeaderboardSpec["format"]): string {
  if (format !== "time") return v.toLocaleString("en-US");
  const cs = Math.round(v * 100), s = Math.floor(cs / 100) % 60, m = Math.floor(cs / 6000) % 60, h = Math.floor(cs / 360000);
  const frac = String(cs % 100).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}.${frac}` : `${m}:${ss}.${frac}`;
}

// ---- what is known, and asking for the rest --------------------------------------------------

type Got<T> = { at: number; value?: T; error?: string };
const listings = new Map<string, Got<string[]>>();
const reads = new Map<string, Got<Leaderboard>>();
const asking = new Set<string>();
/** Per game, the tab and the period the view is on. */
const where = new Map<string, { tab: number; period?: Period }>();
let opened: string | undefined;
let signedIn: boolean | undefined;

const readKey = (game: string, board: string, period: Period, anon: boolean) => `${game}\0${board}\0${period}\0${anon}`;
const stale = (g?: Got<unknown>) => !g || Date.now() - g.at > FRESH_MS;

/** Asks once for what is missing or old, then pushes the tree again; a failure is shown where the board would be. */
function ask<T>(cache: Map<string, Got<T>>, key: string, get: () => Promise<T>, game: string) {
  if (asking.has(key) || !stale(cache.get(key))) return;
  asking.add(key);
  get().then((value) => cache.set(key, { at: Date.now(), value }), (e) => cache.set(key, { at: Date.now(), value: cache.get(key)?.value, error: errorMessage(e) }))
    .finally(() => {
      asking.delete(key);
      if (opened === game) void draw(game).then((v) => view.update(v, { palette: PALETTE, id: game })).catch(() => {});
    });
}

async function listed(game: string): Promise<string[]> {
  const r = await fetch(`${api()}/api/boards/${encodeURIComponent(game)}`);
  if (!r.ok) throw new Error(`the server answered ${r.status}`);
  const j = (await r.json()) as { boards?: { id?: unknown }[] };
  return (j.boards ?? []).flatMap((b) => (typeof b.id === "string" ? [b.id] : []));
}

const hideAnon = async () => (await storage.get<boolean>("hide_anon")) === true;

// ---- the tree --------------------------------------------------------------------------------

/** The games' key hints carry a small caption. */
const hint = (keys: string[], what: string, action?: string): ViewNode[] => keyHint(keys, what, { size: "sm", ...(action && { action }) });

function line(r: LeaderboardRow, format: LeaderboardSpec["format"], key: string): ViewNode {
  return row([
    text(String(r.rank), { style: "number", size: "sm", color: "muted", width: 32, align: "end" }),
    text(r.name, { size: "sm", ...(r.me && { weight: "semibold", color: "accent" }) }),
    ...(r.anon ? [{ type: "badge", text: "anonymous", color: "grey" } as ViewNode] : []),
    ...(r.me ? [{ type: "badge", text: "you", color: "blue" } as ViewNode] : []),
    { type: "spacer" },
    text(formatValue(r.value, format), { style: "number", size: "sm", ...(r.me && { weight: "semibold" }) }),
  ], { key, gap: 2, padding: 1, minHeight: 28, radius: true, ...(r.me && { selected: true }) });
}

/** The open game's tree and actions from what is known now; asks for what is not. */
export async function draw(game: string): Promise<View> {
  const games = await boardGames();
  const g = games.find((x) => x.extension === game);
  if (!g) return { id: game, title: "Leaderboards", tree: column([text("This game has no leaderboards", { style: "muted" })], { padding: 4, grow: true, align: "center", justify: "center" }), actions: [] };
  opened = game;
  const anyStar = g.boards.some((b) => b.id.split("/").includes("*"));
  if (anyStar) ask(listings, game, () => listed(game), game);
  const tabs = tabsOf(g, listings.get(game)?.value ?? []);
  const at = where.get(game) ?? { tab: 0 };
  const i = Math.min(at.tab, Math.max(0, tabs.length - 1));
  const tab = tabs[i];
  const star = !!tab?.spec.id.split("/").includes("*");
  const period: Period = (!star && at.period) || tab?.spec.period || "all";
  const hide = await hideAnon();
  signedIn = await account.get().then((a) => a?.signedIn, () => undefined);

  const acts: Action[] = [{ id: "play", title: `Play ${g.title}`, shortcut: "enter" }];
  if (tabs.length > 1) acts.push({ id: "next", title: "Next board", shortcut: ["right", "tab"] }, { id: "prev", title: "Previous board", shortcut: ["left", "shift+tab"] });
  if (tab && !star) acts.push({ id: "period", title: "All time, this week or today", shortcut: "p" });
  acts.push({ id: "anon", title: hide ? "Show anonymous players" : "Hide anonymous players", shortcut: "a" });
  if (signedIn === false) acts.push({ id: "signin", title: "Sign in to put your scores here", shortcut: "s" });
  if (games.length > 1) acts.push({ id: "game", title: "Another game's leaderboards", shortcut: "g" });
  acts.push({ id: "refresh", title: "Refresh", shortcut: "cmd+r" });
  tabs.forEach((_, n) => acts.push({ id: `tab:${n}`, title: `Board ${n + 1}`, hidden: true, ...(n < 9 && { shortcut: String(n + 1) }) }));

  const tabRow = row(tabs.map((t, n) => text(t.title, { key: `tab-${t.id}`, size: "sm", action: `tab:${n}`, ...(n === i ? { weight: "semibold", color: "accent" } : { color: "muted" }) })), { key: "tabs", gap: 3 });
  const periodRow = tab && !star
    ? row(PERIODS.map((p) => text(p.title, { key: `period-${p.id}`, size: "xs", action: `period:${p.id}`, ...(p.id === period ? { weight: "semibold" } : { color: "muted" }) })), { key: "periods", gap: 2 })
    : null;
  if (periodRow) PERIODS.forEach((p) => acts.push({ id: `period:${p.id}`, title: p.title, hidden: true }));
  const anonSwitch = row([text("Hide anonymous", { size: "xs", color: "muted" }), { type: "switch", on: hide, label: "Hide anonymous", action: "anon" }], { key: "anon", gap: 1 });

  let body: ViewNode[];
  if (!tab) {
    const l = listings.get(game);
    body = [text(anyStar && !l ? "Loading…" : l?.error ? `Could not list the boards: ${l.error}` : "No scores yet: play a round to put the first one here", { key: "empty", style: "muted", size: "sm" })];
  } else {
    const key = readKey(game, tab.id, period, !hide);
    ask(reads, key, () => leaderboard.get(tab.id, { period, anon: !hide }, game), game);
    const got = reads.get(key);
    const b = got?.value;
    if (!b) body = [text(got?.error ? `Could not load this board: ${got.error}` : "Loading…", { key: "empty", style: "muted", size: "sm" })];
    else if (!b.rows.length && !b.me) body = [text("No scores yet: play a round to put the first one here", { key: "empty", style: "muted", size: "sm" })];
    else {
      const shown = b.rows.slice(0, SHOWN);
      const mine = b.me ?? b.rows.find((r) => r.me);
      body = [
        ...shown.map((r) => line(r, tab.spec.format, `r${r.rank}-${r.name}`)),
        ...(mine && !shown.some((r) => r.me) ? [{ type: "divider", key: "me-gap" } as ViewNode, line({ ...mine, me: true }, tab.spec.format, "me")] : []),
      ];
    }
  }
  const signIn = signedIn === false
    ? [row([text("Sign in to put your scores here", { size: "sm", color: "muted" }), { type: "spacer" }, ...hint(["s"], "sign in", "signin")], { key: "signin", gap: 2, padding: 1, minHeight: 28 })]
    : [];

  const tree = column([
    row([tabRow, { type: "spacer" }, anonSwitch], { key: "head", gap: 3 }),
    ...(periodRow ? [periodRow] : []),
    column(body, { key: `board-${tab?.id ?? "none"}-${period}`, gap: 0, transition: { enter: "fade" } }),
    ...signIn,
  ], { key: "boards", padding: 4, gap: 2 });
  return { id: game, title: g.title, tree, actions: acts, keys: "actions" };
}

/** The game the view opens on: the one asked for, else the one open last, else the first with boards. */
export async function gameFor(args: unknown): Promise<string | undefined> {
  const asked = (args as { game?: unknown } | undefined)?.game;
  if (typeof asked === "string") return asked;
  const games = await boardGames();
  return games.find((g) => g.extension === opened)?.extension ?? games[0]?.extension;
}

export async function boardsView(args: unknown): Promise<View> {
  const game = await gameFor(args);
  if (!game) return { title: "Leaderboards", tree: column([text("No game with leaderboards is installed", { style: "muted" })], { padding: 4, grow: true, align: "center", justify: "center" }), actions: [] };
  return draw(game);
}

export async function boardsPick(game: string, action: string | undefined): Promise<Effect> {
  const at = where.get(game) ?? { tab: 0 };
  const g = (await boardGames()).find((x) => x.extension === game);
  const tabs = g ? tabsOf(g, listings.get(game)?.value ?? []) : [];
  const n = Math.max(1, tabs.length);
  switch (action) {
    case "play": return g ? { push: { extension: game, palette: g.palette } } : { keep: true };
    case "next": where.set(game, { ...at, tab: (at.tab + 1) % n }); break;
    case "prev": where.set(game, { ...at, tab: (at.tab - 1 + n) % n }); break;
    case "period": {
      const cur = at.period ?? tabs[at.tab]?.spec.period ?? "all";
      where.set(game, { ...at, period: PERIODS[(PERIODS.findIndex((p) => p.id === cur) + 1) % PERIODS.length].id });
      break;
    }
    case "anon": await storage.set("hide_anon", !(await hideAnon())); break;
    case "signin": await account.signIn(); break;
    case "refresh":
      listings.delete(game);
      for (const k of reads.keys()) if (k.startsWith(`${game}\0`)) reads.delete(k);
      break;
    case "game": {
      const games = await boardGames();
      const next = games[(games.findIndex((x) => x.extension === game) + 1) % games.length];
      if (next) return { view: await draw(next.extension) };
      break;
    }
    default:
      if (action?.startsWith("tab:")) where.set(game, { ...at, tab: Number(action.slice(4)) || 0 });
      else if (action?.startsWith("period:")) where.set(game, { ...at, period: action.slice(7) as Period });
  }
  return { view: await draw(game) };
}
