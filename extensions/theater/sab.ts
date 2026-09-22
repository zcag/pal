// SABnzbd over its one endpoint (`/api?mode=...&output=json`): the queue
// with speed and time left, the history with a failed item's reason,
// pause and resume per item and for everything, delete, the speed limit.
// Everything the Downloads palette and the bar item show of usenet.
import { api, cached, conf, parseClock, speed as fmtSpeed } from "./http.ts";

export type SabSlot = { nzo_id: string; filename: string; status: string; percentage: string; mb: string; mbleft: string; timeleft: string; cat: string; priority: string; size?: string; sizeleft?: string };
export type SabQueue = { version: string; paused: boolean; speed: string; kbpersec: string; speedlimit: string; speedlimit_abs: string; timeleft: string; mbleft: string; noofslots_total: number; slots: SabSlot[]; diskspace1_norm?: string; status: string };
export type SabHistorySlot = { nzo_id: string; name: string; status: string; fail_message: string; category: string; bytes: number; completed: number; storage?: string; download_time?: number };

const call = <T>(query: Record<string, string | number | undefined>) => api<T>("sab", "/api", { query });

export const sabUrl = () => conf("sab").url;
export const version = () => call<{ version: string }>({ mode: "version" });
export const queue = (refresh = false) => cached("sab:queue", 10_000, refresh, async () => (await call<{ queue: SabQueue }>({ mode: "queue", limit: 60 })).queue);
export const history = (refresh = false) => cached("sab:history", 60_000, refresh, async () => (await call<{ history: { slots: SabHistorySlot[] } }>({ mode: "history", limit: 40 })).history.slots);
export const pauseAll = () => call({ mode: "pause" });
export const resumeAll = () => call({ mode: "resume" });
export const pauseItem = (id: string) => call({ mode: "queue", name: "pause", value: id });
export const resumeItem = (id: string) => call({ mode: "queue", name: "resume", value: id });
export const deleteItem = (id: string, files = true) => call({ mode: "queue", name: "delete", value: id, del_files: files ? 1 : 0 });
export const deleteHistory = (id: string) => call({ mode: "history", name: "delete", value: id });
/** `50` (percent of the line), `2M` / `500K` (absolute), `0` (no limit). */
export const setSpeedLimit = (value: string) => call({ mode: "config", name: "speedlimit", value });
export const addUrl = (url: string, name?: string, cat?: string) => call<{ status: boolean; nzo_ids: string[] }>({ mode: "addurl", name: url, nzbname: name, cat });

/** Bytes per second off the queue's `kbpersec`. */
export const speedOf = (q: SabQueue) => Math.round(Number(q.kbpersec) * 1024);
export const speedText = (q: SabQueue) => fmtSpeed(speedOf(q));
export const progressOf = (s: SabSlot) => Number(s.percentage) / 100;
export const sizeOf = (s: SabSlot) => Number(s.mb) * 1024 * 1024;
export const leftOf = (s: SabSlot) => parseClock(s.timeleft);
export const isPaused = (s: SabSlot) => s.status === "Paused";
export const isActive = (s: SabSlot) => s.status === "Downloading";
/** The limit as the UI says it: `50%`, `2.0 MB/s`, or nothing. */
export const limitText = (q: SabQueue) => { const abs = Number(q.speedlimit_abs); return abs > 0 ? fmtSpeed(abs) : Number(q.speedlimit) > 0 && Number(q.speedlimit) < 100 ? `${q.speedlimit}%` : ""; };
