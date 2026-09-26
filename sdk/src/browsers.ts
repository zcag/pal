// Opening a web address in a browser the user picked, and in the
// background: what the core's `open` effect cannot say (it is the OS
// opener, in front, and `apps.open_with` takes a file that exists, not a
// url). Quicklinks' "Open with" and Google Search's "Open in" read the
// same list and spawn the same way.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { Effect } from "./protocol.ts";
import { failed, toast } from "./rows.ts";

const MAC = process.platform === "darwin";
/** The browsers pal knows by the name macOS's `open -a` takes, each with the command Linux runs. */
export const BROWSERS: readonly { app: string; bin: string }[] = [
  { app: "Safari", bin: "" },
  { app: "Google Chrome", bin: "google-chrome" },
  { app: "Firefox", bin: "firefox" },
  { app: "Arc", bin: "" },
  { app: "Brave Browser", bin: "brave" },
  { app: "Microsoft Edge", bin: "microsoft-edge" },
  { app: "Chromium", bin: "chromium" },
  { app: "Vivaldi", bin: "vivaldi" },
  { app: "Zen", bin: "zen" },
];

/**
 * The browsers installed, in the fixed order: app names on macOS, commands
 * on Linux. `PAL_BROWSERS` (a comma list) stands in for the check (the
 * tests).
 */
export function browsers(): string[] {
  const forced = process.env.PAL_BROWSERS;
  if (forced !== undefined) return forced.split(",").map((b) => b.trim()).filter(Boolean);
  if (MAC) return BROWSERS.map((b) => b.app).filter((b) => existsSync(`/Applications/${b}.app`) || existsSync(`${homedir()}/Applications/${b}.app`));
  return BROWSERS.map((b) => b.bin).filter((b) => b && Bun.which(b));
}

/**
 * `url` in `app` (a name from `browsers()`, or a macOS app name picked on
 * another machine: its Linux command is looked up), or in the default
 * browser when `app` is empty; `background` leaves the browser behind the
 * app in front (macOS `open -g`; Linux has no such flag and opens as
 * usual) and keeps the panel open with a toast. Detached, so the panel
 * never waits on the browser. With neither an app nor the background asked
 * for, the core's own opener does it.
 * `PAL_OPEN_URL` names a stand-in taking `<app or "default"> <url>
 * [background]` (the tests).
 */
export function openUrl(url: string, o: { app?: string; background?: boolean } = {}): Effect {
  const app = o.app?.trim() ?? "";
  if (!app && !o.background) return { open: url };
  const stub = process.env.PAL_OPEN_URL;
  const bin = BROWSERS.find((b) => b.app === app)?.bin || app;
  const argv = stub ? [stub, app || "default", url, ...(o.background ? ["background"] : [])]
    : MAC ? ["open", ...(o.background ? ["-g"] : []), ...(app ? ["-a", app] : []), url]
    : app ? [bin, url] : ["xdg-open", url];
  try { Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref(); }
  catch (e) { return failed(`open in ${app || "the browser"}`, e); }
  return o.background ? toast("Opened in the background", url) : { hide: true };
}
