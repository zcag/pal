// qBittorrent's WebUI API v2: the torrents with state, speed and ETA, the
// transfer totals, pause and resume (`stop`/`start` since 5.0, the older
// names before), delete, the download limit. A bearer API key (5.2+)
// signs each request; without one the client logs in with the WebUI
// user and password (a `Referer` on the login, or qBittorrent's CSRF
// guard reports a wrong password).
import { api, cached, conf, type Tag } from "./http.ts";

export type Torrent = { hash: string; name: string; state: string; progress: number; dlspeed: number; upspeed: number; eta: number; size: number; completed: number; category: string; num_seeds: number; num_leechs: number; added_on: number; completion_on: number; ratio: number; content_path?: string; tracker?: string };
export type Transfer = { dl_info_speed: number; up_info_speed: number; dl_rate_limit: number; connection_status: string };

export const qbitUrl = () => conf("qbit").url;
export const version = () => api<string>("qbit", "/api/v2/app/version", { text: true, timeout: 3500 });
const major = async () => Number((await cached("qbit:version", 3600_000, false, version)).replace(/^v/, "").split(".")[0]);
export const torrents = (refresh = false) => cached("qbit:torrents", 10_000, refresh, () => api<Torrent[]>("qbit", "/api/v2/torrents/info", { query: { sort: "added_on", reverse: true } }));
export const transfer = (refresh = false) => cached("qbit:transfer", 10_000, refresh, () => api<Transfer>("qbit", "/api/v2/transfer/info"));
const post = (path: string, form: Record<string, string>) => api("qbit", path, { form, text: true });
export const pause = async (hashes: string) => post(`/api/v2/torrents/${(await major()) >= 5 ? "stop" : "pause"}`, { hashes });
export const resume = async (hashes: string) => post(`/api/v2/torrents/${(await major()) >= 5 ? "start" : "resume"}`, { hashes });
export const remove = (hashes: string, deleteFiles: boolean) => post("/api/v2/torrents/delete", { hashes, deleteFiles: String(deleteFiles) });
/** Bytes per second; 0 lifts the limit. */
export const setDownloadLimit = (limit: number) => post("/api/v2/transfer/setDownloadLimit", { limit: String(limit) });
export const addUrl = (urls: string, category?: string) => post("/api/v2/torrents/add", { urls, ...(category && { category }) });

/** The states that still move bytes, the ones parked by hand, the ones done. */
export const DOWNLOADING = new Set(["downloading", "metaDL", "forcedDL", "allocating", "checkingDL", "stalledDL", "queuedDL", "forcedMetaDL"]);
export const PAUSED = new Set(["pausedDL", "stoppedDL", "pausedUP", "stoppedUP"]);
export const DONE = new Set(["uploading", "stalledUP", "queuedUP", "forcedUP", "checkingUP", "pausedUP", "stoppedUP"]);
export const isDone = (t: Torrent) => t.progress >= 1 || DONE.has(t.state);
export const isPaused = (t: Torrent) => PAUSED.has(t.state);
export const isActive = (t: Torrent) => t.state === "downloading" || t.state === "forcedDL" || t.state === "metaDL";
/** One word for the row's tag. */
export const stateText = (t: Torrent): Tag =>
  t.state === "error" || t.state === "missingFiles" ? { text: t.state === "error" ? "error" : "missing files", color: "red" }
  : isPaused(t) ? { text: "paused", color: "grey" }
  : t.state === "stalledDL" ? { text: "stalled", color: "amber" }
  : t.state === "metaDL" || t.state === "forcedMetaDL" ? { text: "metadata", color: "amber" }
  : t.state === "queuedDL" ? { text: "queued", color: "grey" }
  : t.state.startsWith("checking") ? { text: "checking", color: "grey" }
  : isDone(t) ? { text: "done", color: "green" }
  : { text: "downloading", color: "blue" };
