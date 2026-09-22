// The end-to-end test, the script's `dpi test` done here so the rows
// land one by one: one curl per url, the script's shape (`--max-time 12`,
// through `socks5h://127.0.0.1:<port>` on macOS while the proxy is up,
// direct otherwise), all at once, each answering its HTTP code and how
// long it took. A url is `blocked` (the bypass must get it through) or a
// `control` (a site OOB is known to break, which must keep working); the
// summary says whether both halves hold. The runner is the only impure
// part; `PAL_DPI_CURL` names a stand-in for the tests.
import { exec, type TagColor } from "@zcag/pal";

export type Role = "blocked" | "control";
export type Target = { url: string; role: Role };
/** One row: pending until `code` is set (`000` is curl's word for no answer: a drop, a timeout, a refused connection). */
export type Result = Target & { code?: string; ms?: number };
export type Run = { targets: Target[]; results: Result[]; proxy: string | null; startedAt: number; endedAt?: number };

/** The script's six: two blocked, then four controls that OOB used to break. */
export const DEFAULT_URLS = ["https://discord.com/ = blocked", "https://www.roblox.com/ = blocked", "https://www.enpara.com/ = control", "https://www.raycast.com/ = control", "https://slack.com/ = control", "https://example.com/ = control"];
/** curl's own deadline per url (the script's), and a little over it for the process. */
export const MAX_TIME_S = 12;
const EXEC_MS = (MAX_TIME_S + 3) * 1000;
/** How many urls without a role lead as `blocked` (the script's order: blocked first). */
const LEAD_BLOCKED = 2;
const CURL = process.env.PAL_DPI_CURL || "curl";

/**
 * The `test_urls` setting as targets: `url`, or `url = blocked|control`.
 * A url without a role takes the position's: the first two are blocked,
 * the rest controls, as the script's list reads. Blanks and things that
 * are not urls are dropped.
 */
export function parseTargets(entries: string[]): Target[] {
  const out: Target[] = [];
  for (const raw of entries) {
    const m = /^\s*(\S+?)\s*(?:=\s*(blocked|control)\s*)?$/i.exec(raw);
    if (!m || !/^https?:\/\//i.test(m[1])) continue;
    const role = m[2]?.toLowerCase() as Role | undefined;
    out.push({ url: m[1], role: role ?? (out.length < LEAD_BLOCKED ? "blocked" : "control") });
  }
  return out;
}

/** `discord.com` for a row's name: the host without `www.`. */
export const hostOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** Anything but `000` got through the wire: a 4xx or 5xx answered, which is the site's business, not the block's (the badge still colours it amber). */
export const reached = (code: string | undefined): boolean => !!code && code !== "000";
export const codeColor = (code: string | undefined): TagColor => (code === undefined ? "grey" : !reached(code) ? "red" : /^[45]/.test(code) ? "amber" : "green");
/** `0.4 s`, `12.0 s`. */
export const fmtMs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** One row as a line of text: the url, the code, the time, the role. */
export const line = (r: Result): string => [r.url, r.code ?? "…", r.ms === undefined ? "" : fmtMs(r.ms), r.role].filter(Boolean).join("  ");

/**
 * The header: while rows are pending, how many are in; done, `2 blocked
 * reach, 4 controls fine` when every half holds, else what failed by
 * host (`1 of 2 blocked reach (roblox.com blocked), 3 of 4 controls fine
 * (enpara.com broken)`). Green when everything holds, red when a blocked
 * site is still blocked, amber when only a control broke.
 */
export function summary(results: Result[]): { text: string; color: TagColor } {
  const pending = results.filter((r) => r.code === undefined).length;
  if (pending) return { text: `Testing ${results.length} urls, ${results.length - pending} in…`, color: "grey" };
  const half = (role: Role, ok: string, bad: string) => {
    const rows = results.filter((r) => r.role === role);
    if (!rows.length) return { text: "", fail: 0 };
    const failed = rows.filter((r) => !reached(r.code));
    const noun = role === "blocked" ? "blocked" : rows.length === 1 ? "control" : "controls";
    if (!failed.length) return { text: `${rows.length} ${noun} ${ok}`, fail: 0 };
    return { text: `${rows.length - failed.length} of ${rows.length} ${noun} ${ok} (${failed.map((r) => `${hostOf(r.url)} ${bad}`).join(", ")})`, fail: failed.length };
  };
  const b = half("blocked", "reach", "blocked"), c = half("control", "fine", "broken");
  return { text: [b.text, c.text].filter(Boolean).join(", ") || "Nothing to test", color: b.fail ? "red" : c.fail ? "amber" : "green" };
}

/** curl's argv for one url: silent, the body dropped, the code and the time on stdout, the script's deadline, the proxy when there is one. */
export const curlArgv = (url: string, proxy: string | null): string[] => [CURL, "-s", "-o", "/dev/null", "-w", "%{http_code} %{time_total}", "--max-time", String(MAX_TIME_S), ...(proxy ? ["-x", `socks5h://${proxy}`] : []), url];

/**
 * Starts every target's curl at once; `onRow` runs after each lands
 * (the run's `results` filled in place, in target order) and once more
 * with `endedAt` set. The promise resolves when the last is in.
 */
export function start(targets: Target[], proxy: string | null, onRow: (run: Run) => void, now = Date.now()): Run {
  const run: Run = { targets, results: targets.map((t) => ({ ...t })), proxy, startedAt: now };
  const one = async (i: number) => {
    const t0 = Date.now();
    const r = await exec(curlArgv(targets[i].url, proxy), { ms: EXEC_MS }).catch(() => ({ code: -1, out: "", err: "", timedOut: false }));
    const [code, secs] = r.out.trim().split(/\s+/);
    run.results[i].code = /^\d{3}$/.test(code ?? "") && code !== "000" ? code : "000";
    run.results[i].ms = Number.isFinite(Number(secs)) && Number(secs) > 0 ? Math.round(Number(secs) * 1000) : Date.now() - t0;
    onRow(run);
  };
  Promise.all(targets.map((_, i) => one(i))).then(() => { run.endedAt = Date.now(); onRow(run); });
  return run;
}
