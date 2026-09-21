// Slack against a local mock of the Slack API: a Bun server answering
// `/api/<method>` from fixtures, reached through `PAL_SLACK_API`. The app
// session comes from a synthetic app directory (`PAL_SLACK_APP_DIR`, built
// by slack-auth.test.ts's builders) whose cookie is decrypted with a fake
// `security` on PATH standing in for the keychain (on Linux the jar is
// written under the "peanuts" key Chromium uses without a keyring). Rows
// and sections, the addressed-versus-unread split, the deep links, the lazy
// pane, Mark as read and Reply against the mock, the bar item's badge
// rules and menu, the rate-limit back-off, the re-extraction on
// `invalid_auth`, and the token mode's fallback.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derive } from "../../../extensions/slack/cookies.ts";
import type { Form, View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, HostError, stored } from "../harness.ts";
import { buildAppDir } from "./slack-fixtures.ts";

// ---- fixtures ---------------------------------------------------------------

const TOKEN = "xoxc-1-" + "a".repeat(100), D = "xoxd-abc%2Fdef%3D";
/** The avatar host: a 1 by 1 PNG for anyone (`me.png` 404s, so one row falls back to the initial's tile); the bar popover fetches these into data urls. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const avatarHits: string[] = [];
const avatars = Bun.serve({ port: 0, fetch(req) { const path = new URL(req.url).pathname; avatarHits.push(path); return path === "/me.png" ? new Response("", { status: 404 }) : new Response(PNG, { headers: { "content-type": "image/png" } }); } });
const USERS: Record<string, { name: string; real: string; avatar: string }> = {
  U_ME: { name: "cagdas", real: "Cagdas", avatar: `http://127.0.0.1:${avatars.port}/me.png` },
  U_MARA: { name: "mara", real: "Mara Lindqvist", avatar: `http://127.0.0.1:${avatars.port}/mara.png` },
  U_TOM: { name: "tomas", real: "Tomas Reyes", avatar: `http://127.0.0.1:${avatars.port}/tomas.png` },
  U_ERR: { name: "erin", real: "Erin Vale", avatar: `http://127.0.0.1:${avatars.port}/erin.png` },
};
/** `users.getPresence` per person: Mara is active, Tomas away, Erin is one Slack refuses to answer for; the signed-in user follows `away` (the Status palette flips it). */
const PRESENCE: Record<string, string> = { U_MARA: "active", U_TOM: "away" };
const rawUser = (id: string) => ({ id, name: USERS[id].name, real_name: USERS[id].real, profile: { display_name: USERS[id].name, real_name: USERS[id].real, image_48: USERS[id].avatar } });
const CONVS = [
  { id: "C_GEN", name: "general", is_channel: true, topic: { value: "Company wide" }, num_members: 40 },
  { id: "C_ENG", name: "eng", is_channel: true, purpose: { value: "Engineering" } },
  { id: "C_OPS", name: "ops", is_private: true, num_members: 4 },
  { id: "C_OLD", name: "old", is_channel: true, is_archived: true, num_members: 1 },
  { id: "G_1", name: "mpdm-mara--tomas--cagdas-1", is_mpim: true, num_members: 3 },
  { id: "D_MARA", is_im: true, user: "U_MARA" },
  { id: "D_TOM", is_im: true, user: "U_TOM" },
  { id: "D_ERR", is_im: true, user: "U_ERR" },
];
const HISTORY: Record<string, unknown[]> = {
  D_TOM: [{ ts: "1789580900.000100", user: "U_TOM", text: "ping" }],
  D_ERR: [{ ts: "1789580800.000100", user: "U_ERR", text: "are you around?" }],
  D_MARA: [
    { ts: "1789580400.000200", user: "U_MARA", text: "and the <https://example.com/doc|doc> is up" },
    { ts: "1789580300.000100", user: "U_MARA", text: "hey <@U_ME>, can you look at the parser &amp; the tests?" },
    { ts: "1789500000.000000", user: "U_ME", text: "before last_read, not unread" },
  ],
  C_ENG: [
    { ts: "1789580500.000300", user: "U_TOM", text: "unrelated chatter" },
    { ts: "1789580450.000250", user: "U_MARA", text: "<@U_ME> the build on <#C_OPS|ops> is red", thread_ts: "1789580450.000250" },
    { ts: "1789580420.000240", subtype: "channel_join", user: "U_TOM", text: "<@U_TOM> has joined the channel" },
  ],
};

type Counts = { channels: unknown[]; ims: unknown[]; mpims: unknown[]; threads: unknown };
let counts: Counts = {
  channels: [
    { id: "C_GEN", last_read: "1789580000.000000", latest: "1789580600.000000", mention_count: 0, has_unreads: true },
    { id: "C_ENG", last_read: "1789580400.000000", latest: "1789580500.000300", mention_count: 1, has_unreads: true },
    { id: "C_OPS", last_read: "1789580000.000000", latest: "1789580700.000000", mention_count: 0, has_unreads: true },
  ],
  ims: [
    { id: "D_MARA", last_read: "1789580200.000000", latest: "1789580400.000200", mention_count: 0, has_unreads: true },
    { id: "D_TOM", last_read: "1789580200.000000", latest: "1789580100.000000", mention_count: 0, has_unreads: false },
  ],
  mpims: [],
  threads: { unread_count_by_channel: { C_ENG: 3 } },
};
const QUIET: Counts = { channels: [{ id: "C_GEN", last_read: "1", latest: "2", mention_count: 0, has_unreads: true }], ims: [], mpims: [], threads: {} };
const NONE: Counts = { channels: [], ims: [], mpims: [], threads: {} };

// ---- the mock server ----------------------------------------------------------

type Seen = { method: string; body: Record<string, string>; auth: "app" | "token" | "none" };
const seen: Seen[] = [];
const calls = (method: string) => seen.filter((s) => s.method === method);
let rejectOnce = false, limitOnce = false;
let profile: Record<string, unknown> = { status_emoji: ":palm_tree:", status_text: "Out of office", status_expiration: 1789600000, status_emoji_display_info: [{ emoji_name: "palm_tree", unicode: "1f334" }] };
let snoozeUntil = 0, away = false;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const method = new URL(req.url).pathname.replace(/^\/api\//, "");
    const body = Object.fromEntries(new URLSearchParams(await req.text()));
    const cookie = req.headers.get("cookie") ?? "", bearer = req.headers.get("authorization") ?? "";
    const auth = body.token === TOKEN && cookie === `d=${D}` ? "app" : bearer === "Bearer xoxp-test" ? "token" : "none";
    seen.push({ method, body, auth });
    if (limitOnce) { limitOnce = false; return new Response("", { status: 429, headers: { "retry-after": "1" } }); }
    if (auth === "none") return Response.json({ ok: false, error: "invalid_auth" });
    if (rejectOnce) { rejectOnce = false; return Response.json({ ok: false, error: "invalid_auth" }); }
    const page = (items: unknown[], key: string) => Response.json({ ok: true, [key]: items, response_metadata: { next_cursor: "" } });
    switch (method) {
      case "auth.test": return Response.json({ ok: true, team_id: "T1", user_id: "U_ME", team: "Acme", url: "https://acme.slack.com/" });
      case "client.counts": return auth === "app" ? Response.json({ ok: true, ...counts }) : Response.json({ ok: false, error: "not_allowed_token_type" });
      case "users.conversations": return page(CONVS, "channels");
      case "users.list": return page(Object.keys(USERS).map(rawUser), "members");
      case "users.info": return USERS[body.user] ? Response.json({ ok: true, user: rawUser(body.user) }) : Response.json({ ok: false, error: "user_not_found" });
      case "conversations.info": {
        const c = CONVS.find((x) => x.id === body.channel);
        if (!c) return Response.json({ ok: false, error: "channel_not_found" });
        const unread = c.id === "D_MARA" ? 2 : c.id === "C_GEN" ? 5 : 0;
        return Response.json({ ok: true, channel: { ...c, num_members: c.num_members ?? 12, last_read: "1789580200.000000", latest: { ts: "1789580400.000200" }, unread_count_display: unread } });
      }
      case "conversations.history": {
        const msgs = (HISTORY[body.channel] ?? []).filter((m: any) => m.ts > body.oldest);
        return Response.json({ ok: true, messages: msgs, has_more: body.channel === "C_ENG" });
      }
      case "conversations.mark": return Response.json({ ok: true });
      case "chat.postMessage": return Response.json({ ok: true, ts: "1789590000.000001" });
      case "search.messages": return Response.json({ ok: true, messages: { matches: body.query.includes("nothing") ? [] : [
        { ts: "1789570000.000100", user: "U_MARA", text: "the parser <@U_ME> asked about", channel: { id: "C_ENG", name: "eng" }, permalink: "https://acme.slack.com/archives/C_ENG/p1789570000000100" },
        { ts: "1789560000.000100", user: "U_TOM", text: "dm text", channel: { id: "D_TOM", name: "D_TOM", is_im: true } },
      ] } });
      case "users.profile.get": return Response.json({ ok: true, profile });
      case "users.profile.set": { profile = { ...profile, ...JSON.parse(body.profile) }; return Response.json({ ok: true, profile }); }
      case "dnd.info": return Response.json({ ok: true, snooze_enabled: snoozeUntil > 0, snooze_endtime: snoozeUntil });
      case "dnd.setSnooze": { snoozeUntil = Math.floor(Date.now() / 1000) + Number(body.num_minutes) * 60; return Response.json({ ok: true, snooze_enabled: true, snooze_endtime: snoozeUntil }); }
      case "dnd.endSnooze": { snoozeUntil = 0; return Response.json({ ok: true }); }
      case "users.getPresence":
        if (body.user === "U_ME") return Response.json({ ok: true, presence: away ? "away" : "active", manual_away: away });
        return PRESENCE[body.user] ? Response.json({ ok: true, presence: PRESENCE[body.user] }) : Response.json({ ok: false, error: "user_not_visible" });
      case "users.setPresence": { away = body.presence === "away"; return Response.json({ ok: true }); }
      default: return Response.json({ ok: false, error: `unknown_method ${method}` });
    }
  },
});

// ---- the synthetic app directory and the fake keychain ---------------------------------

const dir = mkdtempSync(join(tmpdir(), "pal-slack-"));
const appDir = join(dir, "Slack");
mkdirSync(appDir);
const PASSWORD = "safe-storage-pw";
// macOS: the extension asks `security` for the Safe Storage password; the fake answers it and logs the ask. Linux: no keyring, the "peanuts" key.
const key = process.platform === "darwin" ? derive(PASSWORD, 1003) : derive("peanuts", 1);
buildAppDir(appDir, { teams: { T1: { id: "T1", name: "Acme", domain: "acme", token: TOKEN, user_id: "U_ME" }, T_NO: { id: "T_NO", name: "Nope", domain: "nope" } } }, D, key);
const bin = join(dir, "bin");
mkdirSync(bin);
const securityLog = join(dir, "security.log");
writeFileSync(join(bin, "security"), `#!/bin/sh\necho "$*" >> ${JSON.stringify(securityLog)}\ncase "$*" in *"Slack Safe Storage"*) echo ${PASSWORD};; *) exit 1;; esac\n`);
chmodSync(join(bin, "security"), 0o755);
const asks = () => { try { return readFileSync(securityLog, "utf8").trim().split("\n").filter(Boolean).length; } catch { return 0; } };
// On Linux the key is the fixed "peanuts" one: no keychain is asked, so the ask counts hold on macOS only.
const KEYCHAIN = process.platform === "darwin";
const PATH0 = process.env.PATH;
/** The overlay every test starts from; a test that changes settings puts it back. */
const BASE = { statuses: [":coffee: Coffee (15m)", "Heads down (today)", ":palm_tree: Away", ":acme_logo: Custom"] };

let host: Host;
beforeAll(async () => {
  stored.clear();
  process.env.PAL_SLACK_API = `http://127.0.0.1:${server.port}`;
  process.env.PAL_SLACK_APP_DIR = appDir;
  process.env.PATH = `${bin}:${PATH0}`;
  host = await Host.bundled({ settings: { slack: { settings: BASE } } });
});
afterAll(() => { host.kill(); server.stop(true); avatars.stop(true); process.env.PATH = PATH0; delete process.env.PAL_SLACK_API; delete process.env.PAL_SLACK_APP_DIR; rmSync(dir, { recursive: true, force: true }); });

const list = (palette: string, query?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("slack", palette, query, ctx);
const pick = (palette: string, id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("slack", palette, id, action, ctx);
const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("slack", () => {
  test("meta: four palettes (unreads live with a lazy pane, channels an hourly catalog, search input, status live), one bar item, the settings", () => {
    const loaded = host.loaded().find((l) => l.extension === "slack")!;
    expect(loaded.warnings).toEqual([]);
    expect(loaded.palettes.map((m) => m.name)).toEqual(["unreads", "channels", "search", "status"]);
    expect(loaded.palettes[0]).toMatchObject({ title: "Unreads", live: true, input: false, detail: "lazy" });
    expect(loaded.palettes[1]).toMatchObject({ title: "Channels", ttl: 3600, tier: "catalog", live: false });
    expect(loaded.palettes[2]).toMatchObject({ title: "Search Slack", input: true });
    expect(loaded.palettes[3]).toMatchObject({ title: "Status", live: true });
    expect(loaded.bar).toEqual([{ id: "unreads", title: "Unreads", description: expect.any(String), mocks: expect.any(Object), refresh: { every: 120, on: ["show", "wake", "network"] }, keys: expect.any(Array), source: true }]);
    expect(loaded.bar[0].keys!.map((k) => k.keys)).toEqual(["enter", "up", "r", "m", "a", "o", "p", "cmd+shift+o", "cmd+c"]);
    expect(host.manifests.get("slack")!.settings!.map((s) => [s.id, s.kind])).toEqual([["auth", "select"], ["token", "secret"], ["workspace", "text"], ["statuses", "list"], ["dm_urgent", "boolean"], ["presence", "boolean"], ["refresh", "number"], ["bar_show", "select"]]);
  });

  test("multi: a workspace is an instance; `workspace` and the token never inherit from the default", () => {
    const m = host.manifests.get("slack")!;
    expect(m.multi).toBe(true);
    expect(m.settings!.filter((s) => s.kind === "secret" || s.scope === "instance").map((s) => s.id)).toEqual(["token", "workspace"]);
    expect((host.loaded().find((l) => l.extension === "slack") as any).instance).toEqual({ key: "slack", isDefault: true });
  });

  describe("unreads", () => {
    test("the app session is extracted (one keychain ask), one client.counts, the rows sectioned DMs, mentions, threads, channels", async () => {
      const items = await list("unreads");
      if (KEYCHAIN) expect(asks()).toBe(1);
      expect(calls("client.counts")).toHaveLength(1);
      expect(calls("client.counts")[0]).toMatchObject({ auth: "app", body: { thread_counts_by_channel: "true" } });
      expect(ids(items)).toEqual(["dm:T1/D_MARA", "mention:T1/C_ENG", "thread:T1/C_ENG", "channel:T1/C_OPS", "channel:T1/C_GEN"]);
      expect(items.map((i) => i.section)).toEqual(["Direct messages", "Mentions", "Threads", "Channels", "Channels"]);
      // History only for the two addressed conversations with a run, never for the quiet channels or the thread.
      expect(calls("conversations.history").map((c) => c.body.channel).sort()).toEqual(["C_ENG", "D_MARA"]);
      expect(calls("conversations.history")[0].body).toMatchObject({ oldest: expect.any(String), inclusive: "false", limit: "60" });
    });

    test("a DM row: the person, the newest unread rendered (link label, entities) without the sender the name already says, their avatar, the count of the run, the presence dot, the time", async () => {
      const [dm] = await list("unreads");
      expect(dm).toMatchObject({ name: "mara", subtitle: "and the doc is up", icon: { image: USERS.U_MARA.avatar } });
      expect(dm.accessories).toEqual([{ tag: "2", color: "red" }, { tag: "●", color: "green" }, { date: 1789580400000 }]);
      expect(dm.actions!.map((a) => a.id)).toEqual(["open", "reply", "read", "browser", "copy"]);
      // The reply is the row's typed argument (Enter still opens); a thread row has neither.
      expect(dm.actions![1]).toEqual({ id: "reply", title: "Reply", args: true });
      expect(dm.args).toEqual([{ id: "text", placeholder: "Message", required: true }]);
      expect((await list("unreads")).find((i) => i.id.startsWith("thread:"))!.args).toBeUndefined();
      expect(dm.keywords).toEqual(expect.arrayContaining(["mara", "dm"]));
    });

    test("a mention row shows the message that names you, not the last one, and skips the join line; a thread row names the count and has no run", async () => {
      const [, mention, thread] = await list("unreads");
      expect(mention).toMatchObject({ name: "#eng", subtitle: "mara: @cagdas the build on #ops is red", icon: { image: USERS.U_MARA.avatar } });
      expect(mention.accessories![0]).toEqual({ tag: "1+", color: "red" });
      expect(thread).toMatchObject({ name: "#eng", subtitle: "3 new replies", icon: "\u{f028c}", accessories: [{ tag: "3", color: "blue" }] });
      expect(thread.actions!.map((a) => a.id)).toEqual(["open", "browser", "copy"]);
    });

    test("quiet channels: named with the channel's glyph (a lock for a private one), the topic or purpose as the subtitle (else that there are new messages), newest first, no count", async () => {
      const items = await list("unreads");
      expect(items[3]).toMatchObject({ name: "#ops", subtitle: "New messages", icon: "\u{f033e}", accessories: [{ date: 1789580700000 }] });
      expect(items[4]).toMatchObject({ name: "#general", subtitle: "Company wide", icon: "\u{f0423}" });
    });

    test("a re-list within 30 s shares the inbox; refresh fetches counts again but the runs are memoised by latest", async () => {
      const before = calls("client.counts").length, hist = calls("conversations.history").length;
      await list("unreads");
      expect(calls("client.counts")).toHaveLength(before);
      await list("unreads", undefined, { refresh: true });
      expect(calls("client.counts")).toHaveLength(before + 1);
      expect(calls("conversations.history")).toHaveLength(hist);
    });

    test("the pane: the unread run oldest first with who and when; a thread's pane names the count", async () => {
      const d = await host.detail("slack", "unreads", "dm:T1/D_MARA");
      expect(d.markdown).toMatch(/^\*\*mara\*\* · .+\n\nhey @cagdas, can you look at the parser & the tests\?\n\n---\n\n\*\*mara\*\* · .+\n\nand the doc is up$/);
      expect(d.metadata!.map((m) => m.label)).toEqual(["Conversation", "Kind", "Unread", "Latest"]);
      expect(d.metadata![1]).toEqual({ label: "Kind", value: "Direct message" });
      const t = await host.detail("slack", "unreads", "thread:T1/C_ENG");
      expect(t.markdown).toContain("3 new replies in threads you follow in #eng");
      const m = await host.detail("slack", "unreads", "mention:T1/C_ENG");
      expect(m.markdown).toContain("…and more before these.");
    });

    test("deep links: Enter opens the app at the message, the browser action the archive page, copy the same url", async () => {
      expect(await pick("unreads", "dm:T1/D_MARA")).toEqual({ open: "slack://channel?team=T1&id=D_MARA&message=1789580400.000200" });
      expect(await pick("unreads", "dm:T1/D_MARA", "browser")).toEqual({ open: "https://acme.slack.com/archives/D_MARA/p1789580400000200" });
      expect(await pick("unreads", "dm:T1/D_MARA", "copy")).toEqual({ copy: "https://acme.slack.com/archives/D_MARA/p1789580400000200" });
      expect(await pick("unreads", "thread:T1/C_ENG")).toEqual({ open: "slack://channel?team=T1&id=C_ENG" });
      expect(await pick("unreads", "channel:T1/C_GEN")).toEqual({ open: "slack://channel?team=T1&id=C_GEN" });
    });

    test("mark as read: conversations.mark up to the conversation's latest, the inbox dropped so the next list fetches", async () => {
      const before = calls("client.counts").length;
      const r = await pick("unreads", "dm:T1/D_MARA", "read");
      expect(r).toMatchObject({ keep: true, toast: { title: "Marked read", message: "mara" } });
      expect(calls("conversations.mark").at(-1)!.body).toMatchObject({ channel: "D_MARA", ts: "1789580400.000200" });
      await list("unreads");
      expect(calls("client.counts")).toHaveLength(before + 1);
    });

    test("reply: the text from the bar posts to the conversation, in the thread for a threaded mention; without values a one-field form whose submit does the same; empty text stays in the form", async () => {
      expect(await pick("unreads", "dm:T1/D_MARA", "reply", { values: { text: "ten minutes" } })).toMatchObject({ keep: true, toast: { title: "Sent", message: "mara: ten minutes" } });
      expect(calls("chat.postMessage").at(-1)!.body).toEqual({ token: TOKEN, channel: "D_MARA", text: "ten minutes", as_user: "true" });
      expect(await pick("unreads", "dm:T1/D_MARA", "reply", { values: { text: " " } })).toMatchObject({ form: { errors: { text: "Required" } } });
      const f = (await pick("unreads", "dm:T1/D_MARA", "reply")).form as Form;
      expect(f).toMatchObject({ id: "dm:T1/D_MARA", title: "Reply to mara", submit: { id: "send", title: "Send" } });
      expect(f.fields.map((x) => [x.kind, x.id, x.required])).toEqual([["text", "text", true]]);
      expect(await pick("unreads", "dm:T1/D_MARA", "send", { values: { text: "  " } })).toMatchObject({ form: { errors: { text: "Required" } } });
      expect(await pick("unreads", "dm:T1/D_MARA", "send", { values: { text: "on it" } })).toMatchObject({ keep: true, toast: { title: "Sent", message: "mara: on it" } });
      expect(calls("chat.postMessage").at(-1)!.body).toEqual({ token: TOKEN, channel: "D_MARA", text: "on it", as_user: "true" });
      await pick("unreads", "mention:T1/C_ENG", "send", { values: { text: "looking" } });
      expect(calls("chat.postMessage").at(-1)!.body).toMatchObject({ channel: "C_ENG", text: "looking", thread_ts: "1789580450.000250" });
    });

    test("nothing addressed and nothing unread is one inert hint", async () => {
      counts = NONE;
      try {
        const items = await list("unreads", undefined, { refresh: true });
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ id: "hint:none", name: "Nothing addressed to you", actions: [] });
      } finally { counts = QUIET; }
    });
  });

  describe("presence", () => {
    /** Three direct messages waiting: Mara (active), Tomas (away) and Erin, whom Slack will not answer for. */
    const THREE: Counts = { ...QUIET, ims: [
      { id: "D_MARA", last_read: "1789580200.000000", latest: "1789580400.000200", mention_count: 0, has_unreads: true },
      { id: "D_TOM", last_read: "1789580200.000000", latest: "1789580900.000100", mention_count: 0, has_unreads: true },
      { id: "D_ERR", last_read: "1789580200.000000", latest: "1789580800.000100", mention_count: 0, has_unreads: true },
    ] };
    const dot = (i: { accessories?: unknown[] }) => (i.accessories ?? []).find((a) => (a as { tag?: string }).tag === "●") as { tag: string; color: string } | undefined;

    test("one users.getPresence per person among the DM rows: green for active, grey for away, none for the one Slack refuses (the row still lists), none on a channel", async () => {
      counts = THREE;
      const before = calls("users.getPresence").length;
      const items = await list("unreads", undefined, { refresh: true });
      expect(ids(items)).toEqual(["dm:T1/D_TOM", "dm:T1/D_ERR", "dm:T1/D_MARA", "channel:T1/C_GEN"]);
      expect(dot(items[2])).toEqual({ tag: "●", color: "green" });
      expect(dot(items[0])).toEqual({ tag: "●", color: "grey" });
      expect(items[1]).toMatchObject({ name: "erin", subtitle: "are you around?" });
      expect(dot(items[1])).toBeUndefined();
      expect(dot(items[3])).toBeUndefined();
      // Mara was asked on the first listing of the file (inside the minute); Tomas and Erin now, once each.
      expect(calls("users.getPresence").slice(before).map((c) => c.body.user).sort()).toEqual(["U_ERR", "U_TOM"]);
      expect(calls("users.getPresence").filter((c) => c.body.user === "U_MARA")).toHaveLength(1);
    });

    test("a second listing within the minute makes no call, the refused one included; the popover carries the same dot on the avatar", async () => {
      const n = calls("users.getPresence").length;
      const items = await list("unreads", undefined, { refresh: true });
      expect(items.map(dot)).toEqual([{ tag: "●", color: "grey" }, undefined, { tag: "●", color: "green" }, undefined]);
      const item = await host.render("slack", "unreads", { reason: "cli" });
      const view = checkView((item as { menu: { view: View } }).menu.view);
      const all = (function walk(node: ViewNode): ViewNode[] { return [node, ...(node.type === "stack" ? node.children.flatMap(walk) : [])]; })(view.tree);
      const images = all.filter((x): x is Extract<ViewNode, { type: "image" }> => x.type === "image");
      expect(images.map((i) => [i.alt, i.dot])).toEqual([["tomas", "grey"], ["erin", undefined], ["mara", "green"]]);
      expect(calls("users.getPresence")).toHaveLength(n);
    });

    test("presence off: no users.getPresence at all and no dot; back on, the lookup resumes", async () => {
      host.changeSettings("slack", { settings: { ...BASE, presence: false } });
      await Bun.sleep(50);
      const n = calls("users.getPresence").length;
      const items = await list("unreads", undefined, { refresh: true });
      expect(items.map(dot)).toEqual([undefined, undefined, undefined, undefined]);
      await host.render("slack", "unreads", { reason: "cli" });
      expect(calls("users.getPresence")).toHaveLength(n);
      host.changeSettings("slack", { settings: BASE });
      await Bun.sleep(50);
      expect(dot((await list("unreads", undefined, { refresh: true }))[2])).toEqual({ tag: "●", color: "green" });
      expect(calls("users.getPresence").length).toBeGreaterThan(n);
      counts = QUIET;
    });
  });

  describe("bar item", () => {
    /** Every node of a tree, depth first. */
    const nodes = (n: ViewNode): ViewNode[] => [n, ...(n.type === "stack" ? n.children.flatMap(nodes) : [])];
    const texts = (v: View) => nodes(v.tree).filter((n): n is Extract<ViewNode, { type: "text" }> => n.type === "text").map((n) => n.value);
    const keycaps = (v: View) => nodes(v.tree).filter((n): n is Extract<ViewNode, { type: "keycap" }> => n.type === "keycap").map((n) => n.keys);
    const viewOf = (r: unknown) => (r as { menu?: { view?: View }; view?: View }).menu?.view ?? (r as { view?: View }).view!;
    const ctx = { reason: "open", compact: true } as const;

    test("the badge is what is addressed (DMs + mentions + thread replies), urgent while a DM waits; the popover is a view: a section per kind, the rows with the avatar as a data url, the quiet channels as badges, the keys", async () => {
      counts = {
        channels: [
          { id: "C_GEN", last_read: "1789580000.000000", latest: "1789580600.000000", mention_count: 0, has_unreads: true },
          { id: "C_ENG", last_read: "1789580400.000000", latest: "1789580500.000300", mention_count: 1, has_unreads: true },
          { id: "C_OPS", last_read: "1789580000.000000", latest: "1789580700.000000", mention_count: 0, has_unreads: true },
        ],
        ims: [{ id: "D_MARA", last_read: "1789580200.000000", latest: "1789580400.000200", mention_count: 0, has_unreads: true }],
        mpims: [],
        threads: { unread_count_by_channel: { C_ENG: 3 } },
      };
      const before = calls("client.counts").length;
      const item = await host.render("slack", "unreads", { reason: "cli" });
      expect(item).toMatchObject({ icon: "\u{f04b1}", badge: 6, urgent: true, refresh: 120, tooltip: "2 direct messages, 1 mention, 3 thread replies; 2 channels unread" });
      // The timer and the show trigger take an inbox under 30 s old: the panel showing fires both the render and the palette's relist for one fetch.
      expect(calls("client.counts")).toHaveLength(before + 1);
      await host.render("slack", "unreads", { reason: "every" });
      await host.render("slack", "unreads", { reason: "show" });
      await list("unreads");
      expect(calls("client.counts")).toHaveLength(before + 1);
      const view = checkView(viewOf(item));
      expect(view).toMatchObject({ id: "inbox", keys: "actions", title: "1 DM · 1 mention · 1 thread" });
      expect(view.input).toBeUndefined();
      const all = nodes(view.tree);
      // The sections and their rows, the cursor on the first, each row a control a click focuses.
      expect(texts(view).filter((t) => ["Direct messages", "Mentions", "Threads", "Also unread"].includes(t))).toEqual(["Direct messages", "Mentions", "Threads", "Also unread"]);
      const rows = all.filter((n): n is Extract<ViewNode, { type: "stack" }> => n.type === "stack" && !!n.action?.startsWith("focus:"));
      expect(rows.map((r) => r.action)).toEqual(["focus:dm:T1/D_MARA", "focus:mention:T1/C_ENG", "focus:thread:T1/C_ENG"]);
      expect(rows.map((r) => !!r.selected)).toEqual([true, false, false]);
      expect(texts(view)).toEqual(expect.arrayContaining(["mara", "and the doc is up", "#eng", "mara: @cagdas the build on #ops is red", "3 new replies in threads you follow"]));
      // Mara's avatar was fetched once into a data url (the picture host needs no session); the thread row is a hash tile.
      const images = all.filter((n): n is Extract<ViewNode, { type: "image" }> => n.type === "image");
      expect(images.map((i) => i.src.slice(0, 22))).toEqual(["data:image/png;base64,", "data:image/png;base64,"]);
      expect(avatarHits.filter((p) => p === "/mara.png")).toHaveLength(1);
      expect(all.find((n) => n.type === "tile")).toMatchObject({ type: "tile", text: "#", fill: "solid" });
      // Counts: the DM run of 2 in red, the thread's 3 in blue; the quiet channels as badges a click opens.
      const badges = all.filter((n): n is Extract<ViewNode, { type: "badge" }> => n.type === "badge");
      expect(badges.map((b) => [b.text, b.color, b.action])).toEqual(expect.arrayContaining([["2", "red", undefined], ["3", "blue", undefined], ["#ops", "grey", "open:channel:T1/C_OPS"], ["#general", "grey", "open:channel:T1/C_GEN"]]));
      expect(keycaps(view)).toEqual(["enter", "r", "m", "a", "o", "p"]);
      expect(view.actions.slice(0, 6).map((a) => [a.id, a.shortcut])).toEqual([["open", undefined], ["reply", "r"], ["read", "m"], ["read-all", ["a", "cmd+shift+a"]], ["open-slack", "o"], ["open-pal", "p"]]);
    });

    test("keys: the cursor moves with the arrows and a click, Enter opens the focused row, the quiet badges open their channel, Open in pal pushes, Open Slack opens the app", async () => {
      // Down twice lands on the thread row (no reply, no read there: those keys leave the hints).
      let r = await host.barAction("slack", "unreads", "down", ctx);
      const v1 = checkView(viewOf(r));
      expect(nodes(v1.tree).filter((n) => n.type === "stack" && !!n.selected).map((n) => n.action)).toEqual(["focus:mention:T1/C_ENG"]);
      r = await host.barAction("slack", "unreads", "down", ctx);
      const v2 = checkView(viewOf(r));
      expect(keycaps(v2)).toEqual(["enter", "a", "o", "p"]);
      expect(await host.barAction("slack", "unreads", "open", ctx)).toEqual({ open: "slack://channel?team=T1&id=C_ENG" });
      // A click on the first row: Enter opens it at the message.
      r = await host.barAction("slack", "unreads", "focus:dm:T1/D_MARA", ctx);
      expect(nodes(checkView(viewOf(r)).tree).filter((n) => n.type === "stack" && !!n.selected).map((n) => n.action)).toEqual(["focus:dm:T1/D_MARA"]);
      expect(await host.barAction("slack", "unreads", "open", ctx)).toEqual({ open: "slack://channel?team=T1&id=D_MARA&message=1789580400.000200" });
      expect(await host.barAction("slack", "unreads", "copy", ctx)).toEqual({ copy: "https://acme.slack.com/archives/D_MARA/p1789580400000200" });
      expect(await host.barAction("slack", "unreads", "open:channel:T1/C_OPS", ctx)).toEqual({ open: "slack://channel?team=T1&id=C_OPS" });
      // The menu-era ids still open their row (links and the CLI spell them).
      expect(await host.barAction("slack", "unreads", "dm:T1/D_MARA")).toEqual({ open: "slack://channel?team=T1&id=D_MARA&message=1789580400.000200" });
      expect(await host.barAction("slack", "unreads", "open-pal", ctx)).toEqual({ push: { extension: "slack", palette: "unreads" } });
      expect(await host.barAction("slack", "unreads", "open-slack", ctx)).toEqual({ open: "slack://open" });
    });

    test("r opens the reply field on the focused row and Enter posts the text as ctx.values.input; an empty send keeps the field; Escape cancels", async () => {
      let r = await host.barAction("slack", "unreads", "reply", ctx);
      let v = checkView(viewOf(r));
      expect(v.input).toEqual({ value: "", placeholder: "Reply to mara", submit: "send", cancel: "cancel" });
      expect(v.title).toBe("Reply to mara");
      expect(v.actions.slice(0, 2).map((a) => a.id)).toEqual(["send", "cancel"]);
      expect(keycaps(v)).toEqual(["enter", "escape"]);
      r = await host.barAction("slack", "unreads", "send", { ...ctx, values: { input: "  " } });
      expect(r.toast).toMatchObject({ title: "Nothing to send", style: "failure" });
      expect(checkView(viewOf(r)).input).toBeDefined();
      const before = calls("chat.postMessage").length;
      r = await host.barAction("slack", "unreads", "send", { ...ctx, values: { input: "on it, give me ten" } });
      expect(calls("chat.postMessage").slice(before).map((c) => c.body)).toEqual([expect.objectContaining({ channel: "D_MARA", text: "on it, give me ten" })]);
      expect(r.toast).toMatchObject({ title: "Sent", message: "mara: on it, give me ten", style: "success" });
      v = checkView(viewOf(r));
      expect(v.input).toBeUndefined();
      expect(keycaps(v)[0]).toBe("enter");
      // A reply into a thread lands in the thread; cancelling leaves the row alone.
      await host.barAction("slack", "unreads", "focus:mention:T1/C_ENG", ctx);
      await host.barAction("slack", "unreads", "reply", ctx);
      r = await host.barAction("slack", "unreads", "cancel", ctx);
      expect(checkView(viewOf(r)).input).toBeUndefined();
      expect(calls("chat.postMessage")).toHaveLength(before + 1);
      await host.barAction("slack", "unreads", "reply", ctx);
      await host.barAction("slack", "unreads", "send", { ...ctx, values: { input: "looking" } });
      expect(calls("chat.postMessage").at(-1)!.body).toMatchObject({ channel: "C_ENG", text: "looking", thread_ts: "1789580450.000250" });
    });

    test("m marks the focused row read and re-renders; Mark all read marks every addressed conversation", async () => {
      await host.barAction("slack", "unreads", "focus:dm:T1/D_MARA", ctx);
      let before = calls("conversations.mark").length;
      expect(await host.barAction("slack", "unreads", "read", ctx)).toEqual({ keep: true, hud: "mara: read" });
      expect(calls("conversations.mark").slice(before).map((c) => c.body)).toEqual([expect.objectContaining({ channel: "D_MARA", ts: "1789580400.000200" })]);
      before = calls("conversations.mark").length;
      expect(await host.barAction("slack", "unreads", "read-all", ctx)).toEqual({ keep: true, hud: "Marked read" });
      expect(calls("conversations.mark").slice(before).map((c) => c.body.channel).sort()).toEqual(["C_ENG", "D_MARA"]);
    });

    test("dm_urgent off: the same inbox is not urgent; a refresh setting under 10 s is clamped", async () => {
      host.changeSettings("slack", { settings: { ...BASE, dm_urgent: false, refresh: 3 } });
      await Bun.sleep(50);
      const item = await host.render("slack", "unreads", { reason: "cli" });
      expect(item).toMatchObject({ badge: 6, urgent: false, refresh: 10 });
      host.changeSettings("slack", { settings: BASE });
      await Bun.sleep(50);
    });

    test("only channels unread is hidden (the count is what is addressed, not what is unread); nothing at all is hidden too; the view of an emptied inbox is inbox zero", async () => {
      counts = QUIET;
      expect(await host.render("slack", "unreads", { reason: "cli" })).toEqual({ hidden: true, refresh: 120 });
      // A key in a popover still up over the emptied inbox draws inbox zero with the quiet channel.
      const r = await host.barAction("slack", "unreads", "down", ctx);
      const v = checkView(viewOf(r));
      expect(texts(v)).toEqual(expect.arrayContaining(["Inbox zero", "Nothing addressed to you; 1 channel is unread"]));
      expect(v.actions[0]).toEqual({ id: "open", title: "Open Slack" });
      counts = NONE;
      expect(await host.render("slack", "unreads", { reason: "update" })).toEqual({ hidden: true, refresh: 120 });
    });

    test("bar_show: unread keeps the glyph while a channel is merely unread, always keeps it at all times; muted, no badge, the popover is inbox zero", async () => {
      try {
        counts = QUIET;
        host.changeSettings("slack", { settings: { ...BASE, bar_show: "unread" } });
        await Bun.sleep(50);
        const quiet = await host.render("slack", "unreads", { reason: "cli" });
        expect(quiet).toMatchObject({ icon: "\u{f04b1}", color: "muted", tooltip: "1 channel unread", refresh: 120 });
        expect(quiet.badge).toBeUndefined();
        expect(quiet.urgent).toBeUndefined();
        expect(texts(checkView(viewOf(quiet)))).toEqual(expect.arrayContaining(["Inbox zero", "Nothing addressed to you; 1 channel is unread"]));
        counts = NONE;
        expect(await host.render("slack", "unreads", { reason: "update" })).toEqual({ hidden: true, refresh: 120 });
        host.changeSettings("slack", { settings: { ...BASE, bar_show: "always" } });
        await Bun.sleep(50);
        const none = await host.render("slack", "unreads", { reason: "cli" });
        expect(none).toMatchObject({ icon: "\u{f04b1}", color: "muted", tooltip: "Nothing unread", refresh: 120 });
        expect(none.badge).toBeUndefined();
        expect(texts(checkView(viewOf(none)))).toContain("Inbox zero");
      } finally {
        host.changeSettings("slack", { settings: BASE });
        await Bun.sleep(50);
      }
    });
  });

  describe("failures", () => {
    test("a 429 backs off for Retry-After: the listing is a hint, no request reaches Slack until it lifts, the bar render is an error", async () => {
      limitOnce = true;
      const items = await list("unreads", undefined, { refresh: true });
      expect(items[0]).toMatchObject({ id: "hint:limit", name: "Slack rate limit reached" });
      const n = seen.length;
      await expect(host.render("slack", "unreads", { reason: "cli" })).rejects.toBeInstanceOf(HostError);
      expect((await list("status"))[0].id).toBe("hint:limit");
      expect(seen.length).toBe(n);
      await Bun.sleep(1100);
      expect((await list("unreads", undefined, { refresh: true }))[0].id).not.toBe("hint:limit");
    });

    test("invalid_auth on the app session: extracted again (a second keychain ask) and the call retried once", async () => {
      counts = NONE;
      const before = asks();
      rejectOnce = true;
      const items = await list("unreads", undefined, { refresh: true });
      expect(items[0].id).toBe("hint:none");
      if (KEYCHAIN) expect(asks()).toBe(before + 1);
      expect(calls("client.counts").slice(-2).map((c) => c.auth)).toEqual(["app", "app"]);
    });

    test("a workspace setting that matches no signed-in one: a hint row saying so, Enter opens the settings; the bar item is hidden", async () => {
      host.changeSettings("slack", { settings: { ...BASE, workspace: "nowhere" } });
      await Bun.sleep(50);
      const items = await list("unreads");
      expect(items[0]).toMatchObject({ id: "hint:auth", name: "Slack is not signed in", subtitle: expect.stringContaining("nowhere") });
      expect(await pick("unreads", "hint:auth")).toEqual({ open: "pal://settings/extensions" });
      expect(await host.render("slack", "unreads", { reason: "cli" })).toEqual({ hidden: true, refresh: 120 });
      host.changeSettings("slack", { settings: BASE });
      await Bun.sleep(50);
    });
  });

  describe("channels", () => {
    test("every conversation you are in, channels then private, groups, DMs; the archived one left out; topic, members (conversations.info for a channel the list gave no count for), tags", async () => {
      const before = calls("conversations.info").length;
      const items = await list("channels");
      expect(calls("conversations.info").slice(before).map((c) => c.body.channel)).toEqual(["C_ENG"]);
      expect(items[0]).toMatchObject({ name: "#eng", subtitle: "Engineering", accessories: [{ text: "12 members" }] });
      await list("channels");
      expect(calls("conversations.info").slice(before)).toHaveLength(1);
      expect(ids(items)).toEqual(["T1/C_ENG", "T1/C_GEN", "T1/C_OPS", "T1/G_1", "T1/D_ERR", "T1/D_MARA", "T1/D_TOM"]);
      expect(items[1]).toMatchObject({ name: "#general", subtitle: "Company wide", icon: "\u{f0423}", accessories: [{ text: "40 members" }] });
      expect(items[2]).toMatchObject({ name: "#ops", icon: "\u{f033e}", accessories: [{ tag: "private", color: "amber" }, { text: "4 members" }] });
      expect(items[3]).toMatchObject({ name: "mara, tomas, cagdas", subtitle: "Group message", accessories: [{ tag: "group", color: "grey" }, { text: "3 members" }] });
      expect(items[5]).toMatchObject({ name: "mara", subtitle: "Direct message", icon: "\u{f0004}", accessories: [{ tag: "DM", color: "grey" }] });
      expect(items.every((i) => i.section === undefined)).toBe(true);
      expect(await pick("channels", "T1/C_GEN")).toEqual({ open: "slack://channel?team=T1&id=C_GEN" });
      // Send a message takes the row's typed argument through the same post a reply uses; a bare pick is a form.
      expect(items[1].args).toEqual([{ id: "text", placeholder: "Message", required: true }]);
      expect(items[1].actions![1]).toEqual({ id: "send", title: "Send a message", shortcut: "cmd+shift+r", args: true });
      expect(await pick("channels", "T1/C_GEN", "send", { values: { text: "lunch at 1?" } })).toMatchObject({ keep: true, toast: { title: "Sent", message: "#general: lunch at 1?" } });
      expect(calls("chat.postMessage").at(-1)!.body).toEqual({ token: TOKEN, channel: "C_GEN", text: "lunch at 1?", as_user: "true" });
      const sendForm = (await pick("channels", "T1/C_GEN", "send")).form as Form;
      expect(sendForm).toMatchObject({ title: "Message #general", submit: { id: "send", title: "Send" } });
      expect(sendForm.fields.map((x) => [x.id, x.kind, !!x.required])).toEqual([["text", "text", true]]);
      expect(((await pick("channels", "T1/C_GEN", "send", { values: { text: "" } })).form as Form).errors).toEqual({ text: "Required" });
      expect(await pick("channels", "T1/C_GEN", "browser")).toEqual({ open: "https://acme.slack.com/archives/C_GEN" });
    });
  });

  describe("search", () => {
    test("a short query is a hint; the query goes through as typed; rows with who, where, the time; Enter opens at the message", async () => {
      expect((await list("search", "p"))[0].id).toBe("hint:search");
      const items = await list("search", "from:@mara parser");
      expect(calls("search.messages").at(-1)!.body).toMatchObject({ query: "from:@mara parser", sort: "timestamp" });
      expect(items[0]).toMatchObject({ name: "the parser @cagdas asked about", subtitle: "mara in #eng", icon: { image: USERS.U_MARA.avatar }, accessories: [{ date: 1789570000000 }] });
      expect(items[1]).toMatchObject({ subtitle: "Direct message" });
      expect(await pick("search", items[0].id)).toEqual({ open: "slack://channel?team=T1&id=C_ENG&message=1789570000.000100" });
      expect(await pick("search", items[0].id, "browser")).toEqual({ open: "https://acme.slack.com/archives/C_ENG/p1789570000000100" });
      expect(await pick("search", items[1].id, "browser")).toEqual({ open: "https://acme.slack.com/archives/D_TOM/p1789560000000100" });
      expect(await pick("search", items[0].id, "copy")).toEqual({ copy: "the parser @cagdas asked about" });
      expect((await list("search", "nothing here"))[0]).toMatchObject({ id: "hint:empty" });
    });
  });

  describe("status", () => {
    test("the first rows are what is set now; then the presets from the setting, Do Not Disturb, presence", async () => {
      const items = await list("status");
      expect(ids(items)).toEqual(["status:current", "dnd:current", "presence:current", "status:0", "status:1", "status:2", "status:3", "status:custom", "dnd:30", "dnd:60", "dnd:tomorrow", "dnd:custom", "presence:away"]);
      // The two rows whose values come from the bar: a status (text, emoji, expiry) and a snooze (minutes).
      expect(items[7]).toMatchObject({ name: "Set a status…", section: "Status", args: [{ id: "text", placeholder: "Status", required: true }, { id: "emoji", placeholder: "Emoji", default: ":speech_balloon:" }, { id: "expiry", kind: "select", default: "" }], actions: [{ id: "set", title: "Set status" }] });
      expect(items[7].args![2].options!.map((o) => o.id)).toEqual(["", "30m", "1h", "2h", "4h", "today"]);
      expect(items[11]).toMatchObject({ name: "Do Not Disturb for…", section: "Do Not Disturb", args: [{ id: "minutes", placeholder: "Minutes", kind: "number", required: true }], actions: [{ id: "snooze", title: "Pause notifications" }] });
      expect(items[0]).toMatchObject({ name: "Out of office", icon: "🌴", section: "Now", actions: [{ id: "clear", title: "Clear status" }] });
      expect(items[0].subtitle).toMatch(/^Your status, until /);
      expect(items[1]).toMatchObject({ name: "Notifications on", actions: [] });
      expect(items[2]).toMatchObject({ name: "Active", actions: [{ id: "presence:toggle", title: "Set away" }] });
      expect(items[3]).toMatchObject({ name: "Coffee", subtitle: "for 15m", icon: "☕", section: "Status" });
      expect(items[4]).toMatchObject({ name: "Heads down", subtitle: "until tomorrow", icon: "💬" });
      expect(items[5]).toMatchObject({ name: "Away", subtitle: "no expiry", icon: "🌴" });
      expect(items[6]).toMatchObject({ name: "Custom", subtitle: ":acme_logo: · no expiry", icon: "\u{f01f2}" });
    });

    test("set a preset (with its expiry), clear it, snooze 30 min, end it, go away and back", async () => {
      expect(await pick("status", "status:0", "set")).toMatchObject({ keep: true, toast: { title: "Status set", message: ":coffee: Coffee (15m)" } });
      const set = JSON.parse(calls("users.profile.set").at(-1)!.body.profile);
      expect(set).toMatchObject({ status_emoji: ":coffee:", status_text: "Coffee" });
      expect(set.status_expiration).toBeGreaterThan(Date.now() / 1000 + 14 * 60);
      expect(set.status_expiration).toBeLessThan(Date.now() / 1000 + 16 * 60);
      await pick("status", "status:2", "set");
      expect(JSON.parse(calls("users.profile.set").at(-1)!.body.profile)).toEqual({ status_emoji: ":palm_tree:", status_text: "Away", status_expiration: 0 });
      expect(await pick("status", "status:current", "clear")).toMatchObject({ toast: { title: "Status cleared" } });
      expect(JSON.parse(calls("users.profile.set").at(-1)!.body.profile)).toEqual({ status_emoji: "", status_text: "", status_expiration: 0 });
      expect((await list("status"))[0]).toMatchObject({ name: "No status", actions: [] });

      expect(await pick("status", "dnd:30", "snooze")).toMatchObject({ toast: { title: "Do Not Disturb on", message: "For 30 minutes" } });
      expect(calls("dnd.setSnooze").at(-1)!.body.num_minutes).toBe("30");
      expect((await list("status"))[1]).toMatchObject({ name: "Do Not Disturb", actions: [{ id: "dnd:end", title: "End Do Not Disturb" }] });
      expect(await pick("status", "dnd:current", "dnd:end")).toMatchObject({ toast: { title: "Do Not Disturb ended" } });
      await pick("status", "dnd:tomorrow", "snooze");
      expect(Number(calls("dnd.setSnooze").at(-1)!.body.num_minutes)).toBeGreaterThan(0);
      await pick("status", "dnd:current", "dnd:end");

      expect(await pick("status", "presence:away", "set")).toMatchObject({ toast: { title: "Set away" } });
      expect(calls("users.setPresence").at(-1)!.body.presence).toBe("away");
      expect((await list("status"))[2]).toMatchObject({ name: "Away", actions: [{ id: "presence:toggle", title: "Set active" }] });
      expect(await pick("status", "presence:current", "presence:toggle")).toMatchObject({ toast: { title: "Set active" } });
      expect(calls("users.setPresence").at(-1)!.body.presence).toBe("auto");
    });

    test("a status typed in the bar: the emoji gets its colons, the expiry lands as the presets' would; a snooze of any minutes; without values either row answers a form with the same fields, an empty or bad value the form with the message", async () => {
      expect(await pick("status", "status:custom", "set", { values: { text: "Pairing", emoji: "computer", expiry: "1h" } })).toMatchObject({ toast: { title: "Status set", message: ":computer: Pairing (1h)" } });
      const set = JSON.parse(calls("users.profile.set").at(-1)!.body.profile);
      expect(set).toMatchObject({ status_emoji: ":computer:", status_text: "Pairing" });
      expect(set.status_expiration).toBeGreaterThan(Date.now() / 1000 + 59 * 60);
      expect(set.status_expiration).toBeLessThan(Date.now() / 1000 + 61 * 60);
      await pick("status", "status:custom", "set", { values: { text: "Lunch", emoji: "", expiry: "" } });
      expect(JSON.parse(calls("users.profile.set").at(-1)!.body.profile)).toEqual({ status_emoji: ":speech_balloon:", status_text: "Lunch", status_expiration: 0 });
      const form = (await pick("status", "status:custom", "set")).form as Form;
      expect(form).toMatchObject({ title: "Set a status", submit: { id: "set", title: "Set status" } });
      expect(form.fields.map((f) => [f.id, f.kind])).toEqual([["text", "text"], ["emoji", "text"], ["expiry", "select"]]);
      expect(((await pick("status", "status:custom", "set", { values: { text: "  ", emoji: "", expiry: "" } })).form as Form).errors).toEqual({ text: "Required" });

      expect(await pick("status", "dnd:custom", "snooze", { values: { minutes: "45" } })).toMatchObject({ toast: { title: "Do Not Disturb on", message: "For 45 minutes" } });
      expect(calls("dnd.setSnooze").at(-1)!.body.num_minutes).toBe("45");
      await pick("status", "dnd:current", "dnd:end");
      expect(((await pick("status", "dnd:custom", "snooze")).form as Form).fields.map((f) => [f.id, f.kind, !!f.required])).toEqual([["minutes", "text", true]]);
      expect(((await pick("status", "dnd:custom", "snooze", { values: { minutes: "0" } })).form as Form).errors).toEqual({ minutes: "A whole number of minutes, 1 or more" });
    });
  });

  describe("token mode", () => {
    test("a user token is a bearer, auth.test names the workspace, client.counts is never asked: unreads come from conversations.info (DMs and unread channels, no mentions or threads)", async () => {
      host.changeSettings("slack", { settings: { ...BASE, auth: "token", token: "xoxp-test" } });
      await Bun.sleep(50);
      const n = calls("client.counts").length;
      const items = await list("unreads", undefined, { refresh: true });
      expect(calls("auth.test").at(-1)!.auth).toBe("token");
      expect(calls("client.counts")).toHaveLength(n);
      expect(ids(items)).toEqual(["dm:T1/D_MARA", "channel:T1/C_GEN"]);
      expect(items[0]).toMatchObject({ name: "mara", subtitle: "and the doc is up" });
      expect(await pick("unreads", "dm:T1/D_MARA", "browser")).toEqual({ open: "https://acme.slack.com/archives/D_MARA/p1789580400000200" });
      expect(calls("conversations.history").at(-1)!.auth).toBe("token");
    });

    test("no token set is a hint naming the setting", async () => {
      host.changeSettings("slack", { settings: { ...BASE, auth: "token", token: "" } });
      await Bun.sleep(50);
      expect((await list("unreads", undefined, { refresh: true }))[0]).toMatchObject({ id: "hint:auth", name: "Slack token is not set" });
      host.changeSettings("slack", { settings: BASE });
      await Bun.sleep(50);
    });
  });
});
