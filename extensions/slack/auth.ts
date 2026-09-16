// Credentials taken from the desktop app rather than asked for. Slack has no
// public "what is unread" call; the client's own `client.counts` answers it
// in one and wants the session the app already holds: the `xoxc-` token per
// workspace, from the app's Local Storage (a LevelDB, `leveldb.ts`), and
// the `d` cookie from its cookie jar (`cookies.ts`). Both files are copied
// before reading, since the app holds a lock on one and writes the other
// under us; nothing is written back. What is read, exactly:
//
//   <app dir>/Local Storage/leveldb/*.{ldb,log}   the key ending in
//       `localConfig_v2`: the app's record of its signed-in workspaces
//       (id, name, domain, user id, token)
//   <app dir>/Cookies                             the `d` cookie for `.slack.com`
//   the keychain / Secret Service                 the "Slack Safe Storage"
//       password that decrypts it (the one step that can prompt, once)
//
// The app dir is `~/Library/Application Support/Slack` on macOS and the
// first of `~/.config/Slack`, the snap and the flatpak locations on Linux;
// `PAL_SLACK_APP_DIR` overrides it (the tests point it at synthetic files).
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { decrypt, encryptedCookie, keyFor } from "./cookies.ts";
import { latest, localStorageText } from "./leveldb.ts";

export type Team = { id: string; name: string; domain: string; token: string; user: string };
export type Creds = { d: string; teams: Record<string, Team> };

export class NotSignedIn extends Error {
  constructor(message: string) { super(message); }
}

const LOCAL_CONFIG = new TextEncoder().encode("localConfig_v2");
const SERVICE = "Slack Safe Storage";

/** Where the desktop app keeps its profile on this machine, or undefined when it is not installed. */
export function appDir(): string | undefined {
  const env = process.env.PAL_SLACK_APP_DIR;
  if (env) return env;
  const home = homedir();
  const candidates = process.platform === "darwin"
    ? [join(home, "Library/Application Support/Slack")]
    : [join(home, ".config/Slack"), join(home, "snap/slack/current/.config/Slack"), join(home, ".var/app/com.slack.Slack/config/Slack")];
  return candidates.find((p) => existsSync(join(p, "Local Storage/leveldb")));
}

/** `localConfig_v2` as the app wrote it: the signed-in teams with their tokens. Reads a copy of the LevelDB directory. */
export function localConfig(dir: string): { teams?: Record<string, { id?: string; name?: string; domain?: string; token?: string; user_id?: string }> } {
  const src = join(dir, "Local Storage/leveldb");
  if (!existsSync(src)) throw new NotSignedIn("Slack's Local Storage is not there; is the desktop app installed and signed in?");
  const tmp = mkdtempSync(join(tmpdir(), "pal-slack-ldb-"));
  try {
    cpSync(src, tmp, { recursive: true, filter: (p) => !p.endsWith("LOCK") });
    const value = latest(tmp, LOCAL_CONFIG);
    if (!value) throw new NotSignedIn("No signed-in workspace in Slack's Local Storage; open Slack and sign in");
    return JSON.parse(localStorageText(value));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** The `d` cookie, decrypted. Stored percent-encoded and sent as stored. */
export async function cookieD(dir: string): Promise<string> {
  const jar = join(dir, "Cookies");
  if (!existsSync(jar)) throw new NotSignedIn("Slack's cookie jar is not there; is the desktop app signed in?");
  const raw = encryptedCookie(jar, ".slack.com", "d");
  if (!raw) throw new NotSignedIn("No session cookie in Slack's cookie jar; open Slack and sign in");
  const key = await keyFor(new TextDecoder("latin1").decode(raw.subarray(0, 3)), SERVICE, "Slack");
  return decrypt(raw, key);
}

/** Both extractions: the teams with a token, and the cookie. `NotSignedIn` names what is missing. */
export async function extract(): Promise<Creds> {
  const dir = appDir();
  if (!dir) throw new NotSignedIn("The Slack desktop app is not installed here; set auth to token instead");
  const cfg = localConfig(dir);
  const teams: Record<string, Team> = {};
  for (const [id, t] of Object.entries(cfg.teams ?? {})) {
    if (!t?.token || !t.domain) continue;
    teams[id] = { id, name: t.name ?? t.domain, domain: t.domain, token: t.token, user: t.user_id ?? t.id ?? "" };
  }
  if (!Object.keys(teams).length) throw new NotSignedIn("No signed-in workspace in Slack; open Slack and sign in");
  return { d: await cookieD(dir), teams };
}
