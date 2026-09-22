// SABnzbd and qBittorrent as one queue: the Downloads and Download
// history palettes, the pause / resume / delete / speed limit actions,
// and the combined state the bar item draws (`downloadsState`). Either
// client alone works; a client that is not set up is simply absent.
import { ago, bytes, hint, tinted, toast, truncate, type Action, type Ctx, type Effect, type Form, type FormValues, type Item } from "@zcag/pal";
import { configured, eta, GLYPH, pct, speed as fmtSpeed, type Tag } from "./http.ts";
import * as sab from "./sab.ts";
import * as qbit from "./qbit.ts";
import { failure, guard, pickHint, str } from "./rows.ts";

/** One download, whichever client has it: what the rows and the popover draw. */
export type Download = { client: "sab" | "qbit"; id: string; name: string; state: Tag; progress: number; size: number; speed: number; left: number; category: string; paused: boolean; active: boolean; done: boolean };
export type DownloadsState = { items: Download[]; speed: number; paused: boolean; sabPaused?: boolean; limits: string[]; errors: string[] };

const fromSab = (s: sab.SabSlot, q: sab.SabQueue): Download => {
  const paused = sab.isPaused(s) || q.paused, active = sab.isActive(s) && !q.paused;
  return { client: "sab", id: s.nzo_id, name: s.filename, state: paused ? { text: "paused", color: "grey" } : active ? { text: "downloading", color: "blue" } : { text: s.status.toLowerCase(), color: "grey" }, progress: sab.progressOf(s), size: sab.sizeOf(s), speed: active ? sab.speedOf(q) : 0, left: active ? sab.leftOf(s) : 0, category: s.cat, paused, active, done: false };
};
const fromQbit = (t: qbit.Torrent): Download => ({ client: "qbit", id: t.hash, name: t.name, state: qbit.stateText(t), progress: t.progress, size: t.size, speed: t.dlspeed, left: t.eta > 0 && t.eta < 8_640_000 ? t.eta : 0, category: t.category, paused: qbit.isPaused(t), active: qbit.isActive(t), done: qbit.isDone(t) });

/** Both queues, the active ones first; a client that fails lands in `errors` rather than taking the other with it. */
export async function downloadsState(refresh = false): Promise<DownloadsState> {
  const st: DownloadsState = { items: [], speed: 0, paused: false, limits: [], errors: [] };
  const flags: boolean[] = [];
  if (configured("sab")) {
    try {
      const q = await sab.queue(refresh);
      st.items.push(...q.slots.map((s) => fromSab(s, q)));
      st.speed += sab.speedOf(q);
      st.sabPaused = q.paused;
      flags.push(q.paused);
      const lim = sab.limitText(q);
      if (lim) st.limits.push(`SABnzbd ${lim}`);
    } catch (e) { st.errors.push(`SABnzbd: ${(e as Error).message}`); }
  }
  if (configured("qbit")) {
    try {
      const [ts, tr] = await Promise.all([qbit.torrents(refresh), qbit.transfer(refresh).catch(() => undefined)]);
      const live = ts.filter((t) => !qbit.isDone(t));
      st.items.push(...live.map(fromQbit));
      st.speed += tr?.dl_info_speed ?? live.reduce((n, t) => n + t.dlspeed, 0);
      flags.push(live.length > 0 && live.every(qbit.isPaused));
      if (tr?.dl_rate_limit) st.limits.push(`qBittorrent ${fmtSpeed(tr.dl_rate_limit)}`);
    } catch (e) { st.errors.push(`qBittorrent: ${(e as Error).message}`); }
  }
  st.paused = flags.length > 0 && flags.every(Boolean);
  st.items.sort((a, b) => Number(b.active) - Number(a.active) || Number(a.paused) - Number(b.paused));
  return st;
}

const CLIENT_TITLE = { sab: "SABnzbd", qbit: "qBittorrent" } as const;
export const clientUrl = (c: "sab" | "qbit") => (c === "sab" ? sab.sabUrl() : qbit.qbitUrl());

export function downloadRow(d: Download): Item {
  return {
    id: `dl:${d.client}:${d.id}`,
    name: d.name,
    subtitle: [d.category, d.state.text === "downloading" && d.speed ? fmtSpeed(d.speed) : "", d.left ? `${eta(d.left)} left` : "", bytes(d.size)].filter(Boolean).join(" · "),
    icon: tinted(d.client === "sab" ? GLYPH.sab : GLYPH.qbit, d.active ? "blue" : "slate"),
    keywords: [CLIENT_TITLE[d.client], d.category, d.state.text].filter(Boolean),
    section: CLIENT_TITLE[d.client],
    accessories: [{ tag: d.state.text, color: d.state.color }, { text: pct(d.progress) }],
    actions: [
      { id: "open", title: `Open ${CLIENT_TITLE[d.client]}` },
      { id: d.paused ? "resume" : "pause", title: d.paused ? "Resume" : "Pause", shortcut: "cmd+enter" },
      { id: "delete", title: "Delete", shortcut: "cmd+backspace", style: "destructive", confirm: `Delete ${truncate(d.name, 50)} and its files from ${CLIENT_TITLE[d.client]}?` },
      { id: "copy", title: "Copy name", shortcut: "cmd+c" },
    ],
  };
}

const limitForm = (errors?: Record<string, string>): Form => ({
  id: "cmd:limit",
  title: "Download speed limit",
  fields: [
    ...(configured("sab") ? [{ kind: "text", id: "sab", label: "SABnzbd", placeholder: "50 (percent), 2M, 500K, 0 for none", description: "A bare number is a percentage of the line speed; K or M an absolute rate; 0 lifts it." } as const] : []),
    ...(configured("qbit") ? [{ kind: "text", id: "qbit", label: "qBittorrent", placeholder: "2M, 500K, 0 for none", description: "An absolute rate; 0 lifts it." } as const] : []),
  ],
  submit: { id: "limit:save", title: "Set limit" },
  errors,
});

/** `2M` / `500K` / `2.5M` as bytes per second; a bare number as `undefined` (SAB reads it as a percentage). */
export function parseRate(s: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*([kKmMgG])?(?:[bB](?:\/s)?)?$/.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] ? Math.round(n * (m[2].toLowerCase() === "k" ? 1024 : m[2].toLowerCase() === "m" ? 1024 ** 2 : 1024 ** 3)) : undefined;
}

async function saveLimit(values: FormValues): Promise<Effect> {
  const errors: Record<string, string> = {};
  const s = str(values.sab).trim(), q = str(values.qbit).trim();
  try {
    if (s) { if (!/^\d+(\.\d+)?\s*[kKmMgG]?[bB]?(\/s)?$/.test(s)) errors.sab = "50, 2M, 500K or 0"; else await sab.setSpeedLimit(s.replace(/\s|b\/s|B\/s|b|B/g, "").toUpperCase()); }
    if (q) { const b = q === "0" ? 0 : parseRate(q); if (b === undefined) errors.qbit = "2M, 500K or 0"; else await qbit.setDownloadLimit(b); }
  } catch (e) { return toast("Could not set the limit", String((e as Error).message), "failure"); }
  if (Object.keys(errors).length) return { form: limitForm(errors) };
  return toast("Speed limit set", [s && `SABnzbd ${s}`, q && `qBittorrent ${q === "0" ? "unlimited" : q}`].filter(Boolean).join(", "));
}

export async function pauseAll(): Promise<string[]> {
  const did: string[] = [];
  if (configured("sab")) { await sab.pauseAll(); did.push("SABnzbd"); }
  if (configured("qbit")) { await qbit.pause("all"); did.push("qBittorrent"); }
  return did;
}
export async function resumeAll(): Promise<string[]> {
  const did: string[] = [];
  if (configured("sab")) { await sab.resumeAll(); did.push("SABnzbd"); }
  if (configured("qbit")) { await qbit.resume("all"); did.push("qBittorrent"); }
  return did;
}

const COMMANDS = (st: DownloadsState): Item[] => [
  { id: "cmd:toggle", name: st.paused ? "Resume all" : "Pause all", subtitle: st.paused ? "Both clients pick their queues back up" : "SABnzbd and qBittorrent stop fetching until resumed", icon: st.paused ? GLYPH.play : GLYPH.pause, keywords: ["pause", "resume"], section: "Downloads", actions: [{ id: "run", title: st.paused ? "Resume all" : "Pause all" }] },
  { id: "cmd:limit", name: "Set speed limit", subtitle: st.limits.length ? `Now: ${st.limits.join(", ")}` : "No limit set", icon: GLYPH.speed, keywords: ["throttle", "bandwidth"], section: "Downloads", actions: [{ id: "run", title: "Set limit" }] },
];

export async function queueRows(refresh: boolean): Promise<Item[]> {
  if (!configured("sab") && !configured("qbit")) return [];
  return guard(async () => {
    const st = await downloadsState(refresh);
    const rows: Item[] = [...COMMANDS(st), ...st.errors.map((e) => hint(`err:${e.slice(0, 8)}`, e, "cmd+r tries again", { icon: GLYPH.alert, section: "Downloads" })), ...st.items.map(downloadRow)];
    if (!st.items.length) rows.push(hint("idle", "Nothing downloading", `${[configured("sab") && "SABnzbd", configured("qbit") && "qBittorrent"].filter(Boolean).join(" and ")} ${configured("sab") && configured("qbit") ? "are" : "is"} idle`, { icon: GLYPH.check, section: "Downloads" }));
    return rows;
  });
}

const HISTORY_ACTIONS = (client: "sab" | "qbit", name: string): Action[] => [
  { id: "open", title: `Open ${CLIENT_TITLE[client]}` },
  { id: "forget", title: client === "sab" ? "Remove from history" : "Remove torrent", shortcut: "cmd+backspace", style: "destructive", confirm: client === "sab" ? `Remove ${truncate(name, 50)} from SABnzbd's history?` : `Remove ${truncate(name, 50)} from qBittorrent (the files stay)?` },
  { id: "copy", title: "Copy name", shortcut: "cmd+c" },
];

export async function historyRows(refresh: boolean): Promise<Item[]> {
  if (!configured("sab") && !configured("qbit")) return [];
  const rows: Item[] = [];
  if (configured("sab")) {
    try {
      for (const h of await sab.history(refresh)) {
        const failed = h.status === "Failed";
        rows.push({ id: `hist:sab:${h.nzo_id}`, name: h.name, subtitle: [h.category, bytes(h.bytes), failed && h.fail_message ? truncate(h.fail_message, 90) : ""].filter(Boolean).join(" · "), icon: tinted(GLYPH.sab, failed ? "red" : "slate"), keywords: ["sabnzbd", h.category, h.status.toLowerCase()], section: "SABnzbd", accessories: [{ tag: failed ? "failed" : h.status.toLowerCase(), color: failed ? "red" : h.status === "Completed" ? "green" : "grey" }, { date: h.completed * 1000 }], detail: failed ? { markdown: `**Failed**\n\n${h.fail_message}` } : { metadata: [{ label: "Status", value: h.status }, { label: "Size", value: bytes(h.bytes) }, ...(h.storage ? [{ label: "Stored", value: h.storage }] : []), { label: "Finished", value: ago(h.completed * 1000) }] }, actions: HISTORY_ACTIONS("sab", h.name) });
      }
    } catch (e) { rows.push(...failure(e)); }
  }
  if (configured("qbit")) {
    try {
      for (const t of (await qbit.torrents(refresh)).filter(qbit.isDone)) {
        const failed = t.state === "error" || t.state === "missingFiles";
        rows.push({ id: `hist:qbit:${t.hash}`, name: t.name, subtitle: [t.category, bytes(t.size), `ratio ${t.ratio.toFixed(2)}`].filter(Boolean).join(" · "), icon: tinted(GLYPH.qbit, failed ? "red" : "slate"), keywords: ["qbittorrent", t.category, t.state], section: "qBittorrent", accessories: [{ tag: failed ? qbit.stateText(t).text : "done", color: failed ? "red" : "green" }, ...(t.completion_on > 0 ? [{ date: t.completion_on * 1000 }] : [])], actions: HISTORY_ACTIONS("qbit", t.name) });
      }
    } catch (e) { rows.push(...failure(e)); }
  }
  return rows.length ? rows : [hint("none", "No finished downloads yet", "What SABnzbd and qBittorrent complete shows here", { icon: GLYPH.history })];
}

export async function pick(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return pickHint(id);
  if (id === "cmd:limit") return action === "limit:save" ? saveLimit(ctx?.values ?? {}) : { form: limitForm() };
  if (id === "cmd:toggle") {
    try {
      const st = await downloadsState();
      const did = st.paused ? await resumeAll() : await pauseAll();
      return toast(st.paused ? "Resumed" : "Paused", did.join(" and "));
    } catch (e) { return toast("Could not pause", String((e as Error).message), "failure"); }
  }
  const m = /^(dl|hist):(sab|qbit):(.+)$/.exec(id);
  if (!m) return;
  const client = m[2] as "sab" | "qbit", key = m[3];
  const name = () => (client === "sab" ? sab.queue().then((q) => q.slots.find((s) => s.nzo_id === key)?.filename) : qbit.torrents().then((ts) => ts.find((t) => t.hash === key)?.name)).catch(() => undefined);
  try {
    switch (action) {
      case "copy": return { copy: (await name()) ?? key };
      case "pause": client === "sab" ? await sab.pauseItem(key) : await qbit.pause(key); return toast("Paused");
      case "resume": client === "sab" ? await sab.resumeItem(key) : await qbit.resume(key); return toast("Resumed");
      case "delete": client === "sab" ? await sab.deleteItem(key) : await qbit.remove(key, true); return toast("Deleted");
      case "forget": client === "sab" ? await sab.deleteHistory(key) : await qbit.remove(key, false); return toast("Removed");
      default: return { open: clientUrl(client) };
    }
  } catch (e) { return toast(`Could not ${action}`, String((e as Error).message), "failure"); }
}

/** For the Theater rows: SABnzbd's version with its speed and queue, qBittorrent's with its torrents. */
export async function sabHealth() {
  const [v, q] = await Promise.all([sab.version(), sab.queue().catch(() => undefined)]);
  return { version: v.version, note: q ? (q.paused ? `paused, ${q.noofslots_total} queued` : q.noofslots_total ? `${sab.speedText(q)}, ${q.noofslots_total} queued` : "idle") + (q.diskspace1_norm ? ` · ${q.diskspace1_norm} free` : "") : "", url: sab.sabUrl(), warn: !!q?.paused };
}
export async function qbitHealth() {
  const [v, ts, tr] = await Promise.all([qbit.version(), qbit.torrents().catch(() => [] as qbit.Torrent[]), qbit.transfer().catch(() => undefined)]);
  const live = ts.filter((t) => !qbit.isDone(t));
  return { version: v.replace(/^v/, ""), note: [live.length ? `${live.length} downloading` : `${ts.length} torrents, none active`, tr?.dl_info_speed ? fmtSpeed(tr.dl_info_speed) : "", tr && tr.connection_status !== "connected" ? tr.connection_status : ""].filter(Boolean).join(" · "), url: qbit.qbitUrl(), warn: tr?.connection_status === "disconnected" };
}
