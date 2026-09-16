// 1Password over the `op` CLI (ported from v1's `op` palette). One `op item
// list --format json` per listing, kept for `ttl` seconds so the per-vault
// filters and a Refresh inside the ttl do not ask the CLI (and its biometric
// prompt) again. A secret is only ever fetched on a pick, straight from
// `op item get`, and goes to the clipboard: it is never in a row, a log or
// the index. Signed out (or no account set up) is one hint row telling how
// to sign in; a missing CLI is one pointing at the install page. The
// unlock prompt, when the desktop app integration is on, is the CLI's own.
// A password or a one-time code is a concealed copy (`conceal`): marked
// for clipboard managers to skip, out of pal's own history, and replaced
// by the previous clipboard after 30 s; the username is a plain copy.
import { existsSync } from "node:fs";
import { CONCEAL_SECONDS, conceal, settings, type Accessory, type Action, type Effect, type Extension, type Item } from "@zcag/pal";

/** `[extensions.onepassword]`, defaults in pal.json. */
type Settings = { account: string; vaults: string[]; ttl: number };

/** `op item list --format json`, the fields used here. */
type OpItem = { id: string; title: string; category: string; vault: { id: string; name: string }; additional_information?: string; urls?: { href: string; primary?: boolean }[]; favorite?: boolean; tags?: string[]; updated_at?: string };
type OpAccount = { url?: string; email?: string; user_uuid?: string; account_uuid?: string; shorthand?: string };

/** md-shield_key, the palette's own row and the fallback for a category not in the table. */
const ICON = "\u{f0bc4}";
const INSTALL_URL = "https://developer.1password.com/docs/cli/get-started/";
const SIGNIN_URL = "https://developer.1password.com/docs/cli/app-integration/";
/** The app under launchd has a bare PATH; where the CLI's installers put it. */
const OP_FALLBACKS = ["/opt/homebrew/bin/op", "/usr/local/bin/op", "/usr/bin/op"];
/** One CLI call at most; a biometric prompt left unanswered stops here. */
const OP_MS = 60_000;

/** Material Design glyphs from the bundled Nerd Font, one per 1Password category. */
const CATEGORY_ICON: Record<string, string> = {
  LOGIN: "\u{f030b}", PASSWORD: "\u{f030b}", SECURE_NOTE: "\u{f039e}", CREDIT_CARD: "\u{f019b}", BANK_ACCOUNT: "\u{f0070}", IDENTITY: "\u{f0dab}", SSH_KEY: "\u{f1574}",
  API_CREDENTIAL: "\u{f109b}", DATABASE: "\u{f01bc}", SERVER: "\u{f048b}", WIRELESS_ROUTER: "\u{f0469}", MEMBERSHIP: "\u{f02a3}", SOFTWARE_LICENSE: "\u{f0fc3}", DOCUMENT: "\u{f09ee}",
};
/** md-download, md-login, md-alert_octagon for the hint rows. */
const HINT_ICON = { install: "\u{f01da}", signin: "\u{f0342}", error: "\u{f0029}" };
const category = (c: string) => c.toLowerCase().replace(/_/g, " ");

const ACTIONS: Action[] = [
  { id: "password", title: "Copy password" },
  { id: "username", title: "Copy username", shortcut: "cmd+u" },
  { id: "otp", title: "Copy one-time code", shortcut: "cmd+t" },
  { id: "open", title: "Open in 1Password", shortcut: "cmd+o" },
];

const opPath = (): string | undefined => Bun.which("op") ?? OP_FALLBACKS.find((p) => existsSync(p));

/** One `op` invocation; the message of a failure is the CLI's stderr without its `[ERROR] <time>` prefix. */
async function op(args: string[]): Promise<string> {
  const bin = opPath();
  if (!bin) throw new Error("op is not installed");
  const { account } = settings.get<Settings>();
  const proc = Bun.spawn([bin, ...args, ...(account ? ["--account", account] : [])], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  // `op` blocks while 1Password waits for an unlock or for the "allow pal" prompt; past the limit it is killed and the row says what to do.
  let late = false;
  const timer = setTimeout(() => { late = true; proc.kill(); }, OP_MS);
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if (late) throw new Error(`1Password did not answer within ${OP_MS / 1000} s: unlock it, allow pal when it asks, then refresh with cmd+r`);
  if (code !== 0) throw new Error(err.replace(/^\[ERROR\]\s*[\d/]+\s+[\d:]+\s*/gm, "").trim() || `op exited ${code}`);
  return out;
}

const signedOut = (msg: string) => /not (currently )?signed in|no accounts? configured|op signin|account .* not found|session expired/i.test(msg);

// ---- the item list, cached -----------------------------------------------------

let cache: { at: number; items: OpItem[] } | undefined;
let accounts: OpAccount[] | undefined;
const byId = new Map<string, OpItem>();

async function items(refresh = false): Promise<OpItem[]> {
  const { ttl } = settings.get<Settings>();
  if (!refresh && cache && Date.now() - cache.at < ttl * 1000) return cache.items;
  const list = JSON.parse(await op(["item", "list", "--format", "json"]) || "[]") as OpItem[];
  cache = { at: Date.now(), items: list };
  byId.clear();
  for (const i of list) byId.set(i.id, i);
  return list;
}

/** The account's uuid for the app's `view-item` link: the configured one, else the only one. */
async function accountUuid(): Promise<string | undefined> {
  const { account } = settings.get<Settings>();
  try { accounts ??= JSON.parse(await op(["account", "list", "--format", "json"]) || "[]") as OpAccount[]; } catch { return undefined; }
  const match = account ? accounts.find((a) => [a.shorthand, a.url, a.account_uuid, a.user_uuid, a.email].includes(account)) : accounts.length === 1 ? accounts[0] : undefined;
  return match?.account_uuid;
}

// ---- rows -----------------------------------------------------------------------

const host = (href: string) => { try { return new URL(href.includes("://") ? href : `https://${href}`).hostname.replace(/^www\./, ""); } catch { return href; } };

function item(i: OpItem): Item {
  const hosts = (i.urls ?? []).map((u) => host(u.href)).filter(Boolean);
  const primary = (i.urls ?? []).find((u) => u.primary) ?? i.urls?.[0];
  const accessories: Accessory[] = [];
  if (i.favorite) accessories.push({ tag: "favorite", color: "amber" });
  if (hosts[0]) accessories.push({ text: hosts[0] });
  return {
    id: i.id,
    name: i.title,
    subtitle: [i.vault.name, i.additional_information].filter(Boolean).join(" · "),
    icon: CATEGORY_ICON[i.category] ?? ICON,
    keywords: [...new Set([...hosts, i.additional_information ?? "", category(i.category), i.vault.name, ...(i.tags ?? [])].filter(Boolean))],
    accessories,
    detail: {
      metadata: [
        { label: "Vault", value: i.vault.name },
        { label: "Category", value: category(i.category) },
        ...(i.additional_information ? [{ label: "Username", value: i.additional_information }] : []),
        ...(primary ? [{ label: "Website", link: { text: primary.href, href: primary.href } }] : []),
        ...(i.tags?.length ? [{ label: "Tags", tags: i.tags.map((t) => ({ text: t })) }] : []),
        ...(i.updated_at ? [{ label: "Updated", value: new Date(i.updated_at).toLocaleString() }] : []),
      ],
    },
    actions: ACTIONS,
  };
}

const hint = (id: string, name: string, subtitle: string, actions: Action[] = [], icon = ICON): Item => ({ id, name, subtitle, icon, actions });

const s0 = settings.get<Settings>();
const FILTERS = s0.vaults.length ? [{ id: "all", title: "All vaults" }, ...s0.vaults.map((v) => ({ id: v, title: v }))] : undefined;

async function list(filter = "all", refresh = false): Promise<Item[]> {
  const { vaults } = settings.get<Settings>();
  if (!opPath()) return [hint("install", "1Password CLI not installed", "Install the op command line tool; Enter opens the install page", [{ id: "install", title: "Open install page" }], HINT_ICON.install)];
  let all: OpItem[];
  try { all = await items(refresh); } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // A terminal's `op signin` session never reaches pal; the desktop app integration is the way.
    // The CLI reaches the vault through the desktop app: not running, locked, or the integration off are the three failures a user can fix.
    if (/couldn't connect to the 1Password desktop app/i.test(msg)) return [hint("app", "1Password is not running", "The CLI reaches the vault through the app; Enter opens 1Password, then refresh with cmd+r", [{ id: "open", title: "Open 1Password" }], HINT_ICON.signin)];
    if (/context deadline exceeded|did not answer/i.test(msg)) return [hint("locked", "1Password did not answer", "Unlock 1Password (or allow pal when it asks), then refresh with cmd+r", [{ id: "open", title: "Open 1Password" }], HINT_ICON.signin)];
    if (signedOut(msg)) return [hint("signin", "Connect the 1Password CLI to the app", "In 1Password: Settings, Developer, turn on \"Integrate with 1Password CLI\"; then refresh with cmd+r and allow pal when 1Password asks", [{ id: "help", title: "Open the setup guide" }], HINT_ICON.signin)];
    return [hint("error", "1Password CLI failed", msg.split("\n")[0], [{ id: "help", title: "Open the troubleshooting guide" }], HINT_ICON.error)];
  }
  const wanted = new Set(vaults.map((v) => v.toLowerCase()));
  const rows = all.filter((i) => (filter !== "all" ? i.vault.name.toLowerCase() === filter.toLowerCase() : wanted.size === 0 || wanted.has(i.vault.name.toLowerCase())));
  rows.sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  if (rows.length === 0) return [hint("none", "No items", filter !== "all" ? `Nothing in the vault ${filter}` : "The account has no items you can see")];
  return rows.map(item);
}

const failed = (what: string, e: unknown) => ({ keep: true as const, toast: { title: `Could not ${what}`, message: String((e as Error)?.message ?? e), style: "failure" as const } });
/** A secret onto the clipboard, concealed and cleared after `CONCEAL_SECONDS`; the HUD says so. */
const secret = (what: string, value: string): Effect => ({ copy: conceal(value), hud: `Copied ${what}, clears in ${CONCEAL_SECONDS} s` });

export default {
  palettes: {
    items: {
      title: "1Password",
      ttl: s0.ttl,
      placeholder: "Search items and websites",
      ...(FILTERS ? { filters: FILTERS } : {}),
      list: (_query, ctx) => list(ctx?.filter, ctx?.refresh),
      pick: async (id, action) => {
        if (id === "install") return { open: INSTALL_URL };
        if (id === "signin") return action === "help" ? { open: SIGNIN_URL } : { keep: true };
        if (id === "app" || id === "locked") return { open: process.platform === "darwin" ? "/Applications/1Password.app" : "1password://", hud: "Opening 1Password" };
        if (id === "error") return action === "help" ? { open: "https://developer.1password.com/docs/cli/app-integration/#troubleshooting" } : { keep: true };
        if (id === "error" || id === "none") return { keep: true };
        switch (action) {
          case "username": {
            try { return { copy: (await op(["item", "get", id, "--fields", "label=username", "--reveal"])).trim(), hud: "Copied username" }; } catch (e) { return failed("copy the username", e); }
          }
          case "otp": {
            try { return secret("one-time code", (await op(["item", "get", id, "--otp"])).trim()); } catch (e) { return failed("copy the one-time code", e); }
          }
          case "open": {
            const i = byId.get(id);
            const a = await accountUuid();
            return { open: `onepassword://view-item?i=${encodeURIComponent(id)}${i ? `&v=${encodeURIComponent(i.vault.id)}` : ""}${a ? `&a=${encodeURIComponent(a)}` : ""}` };
          }
          default: {
            try { return secret("password", (await op(["item", "get", id, "--fields", "label=password", "--reveal"])).trim()); } catch (e) { return failed("copy the password", e); }
          }
        }
      },
    },
  },
} satisfies Extension;
