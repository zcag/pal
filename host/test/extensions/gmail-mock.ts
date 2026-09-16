// A Bun mock of the Gmail API v1 for gmail.test.ts: two mailboxes (one
// per bearer token), the calls the extension makes (`profile`, `labels`,
// `messages.list` with a small query parser, `messages.get` in the
// metadata and full formats, `batchModify`, `messages.send`, drafts),
// every request recorded, a 401 for an unknown token, a 429 on demand;
// and a stand-in for Gravatar (a HEAD answering 200 for the addresses it
// knows). The mail is invented.

export type Box = { address: string; labels: { id: string; name: string; type: "system" | "user" }[]; messages: Msg[]; drafts: { id: string; message: string }[] };
export type Msg = { id: string; threadId: string; labelIds: string[]; from: string; to: string; cc?: string; subject: string; date: string; snippet: string; text?: string; html?: string; attachments?: { filename: string; mimeType: string; size: number }[]; messageId?: string };

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const SYSTEM = ["INBOX", "UNREAD", "STARRED", "IMPORTANT", "SENT", "DRAFT", "SPAM", "TRASH", "CATEGORY_PERSONAL", "CATEGORY_UPDATES", "CATEGORY_PROMOTIONS"].map((id) => ({ id, name: id, type: "system" as const }));

export const personal: Box = {
  address: "someone@gmail.com",
  labels: [...SYSTEM, { id: "Label_1", name: "GitHub", type: "user" }, { id: "Label_2", name: "Receipts", type: "user" }, { id: "Label_3", name: "Family/Trips", type: "user" }],
  messages: [
    { id: "m1", threadId: "t1", labelIds: ["INBOX", "UNREAD", "IMPORTANT", "CATEGORY_PERSONAL"], from: "Mara Lind <mara@example.com>", to: "someone@gmail.com", subject: "Parser review before standup?", date: "Wed, 16 Sep 2026 09:12:00 +0000", snippet: "Can you look at the parser before standup? The tests are green now &amp; the diff is small.", text: "Can you look at the parser before standup? The tests are green now & the diff is small.\n\nOn Tue, 15 Sep 2026, Someone <someone@gmail.com> wrote:\n> Sure, send it over.\n> I have time tomorrow.", messageId: "<m1@example.com>" },
    { id: "m2", threadId: "t2", labelIds: ["INBOX", "UNREAD", "Label_1", "CATEGORY_UPDATES"], from: "GitHub <notifications@github.com>", to: "someone@gmail.com", subject: "[zcag/pal] Instances phase 2 (PR #81)", date: "Wed, 16 Sep 2026 08:40:00 +0000", snippet: "tomas-r requested your review on #81.", html: "<html><head><style>p{}</style></head><body><p>tomas-r requested your review on <a href=\"https://github.com/zcag/pal/pull/81\">#81</a>.</p><ul><li>Settings page</li><li>Bar rows</li></ul><div class=\"gmail_quote\"><div>On Wed, tomas wrote:</div><blockquote>old text</blockquote></div><p>&#169; GitHub</p></body></html>" },
    { id: "m3", threadId: "t3", labelIds: ["INBOX", "UNREAD", "Label_2"], from: "Acme Billing <billing@acme.example>", to: "someone@gmail.com", subject: "Your September invoice", date: "Tue, 15 Sep 2026 22:05:00 +0000", snippet: "Invoice 2026-09 is attached.", text: "Invoice 2026-09 is attached.\n\nThanks,\nAcme", attachments: [{ filename: "invoice-2026-09.pdf", mimeType: "application/pdf", size: 48213 }] },
    { id: "m4", threadId: "t4", labelIds: ["INBOX", "UNREAD", "STARRED", "Label_3"], from: "Ola Berg <ola@example.com>", to: "someone@gmail.com", cc: "Tomas Ruiz <tomas@example.com>", subject: "Trip: cabin booked for October", date: "Tue, 15 Sep 2026 18:30:00 +0000", snippet: "Booked the cabin for the 10th to the 12th, details below.", text: "Booked the cabin for the 10th to the 12th, details below.\n\nCheck-in 15:00, key box code 4471.", attachments: [{ filename: "booking.pdf", mimeType: "application/pdf", size: 120334 }, { filename: "map.png", mimeType: "image/png", size: 88000 }] },
    { id: "m5", threadId: "t5", labelIds: ["INBOX", "Label_1"], from: "GitHub <notifications@github.com>", to: "someone@gmail.com", subject: "[zcag/pal] Release v0.1.0 published", date: "Tue, 15 Sep 2026 12:00:00 +0000", snippet: "Release v0.1.0 is out.", text: "Release v0.1.0 is out." },
    { id: "m6", threadId: "t6", labelIds: ["INBOX"], from: "Lina Kova <lina@example.com>", to: "someone@gmail.com", subject: "Re: Dinner on Friday", date: "Mon, 14 Sep 2026 20:15:00 +0000", snippet: "Friday works, 19:30 at the usual place?", text: "Friday works, 19:30 at the usual place?" },
    { id: "m7", threadId: "t7", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"], from: "Newsletter <news@shop.example>", to: "someone@gmail.com", subject: "Autumn sale starts now", date: "Mon, 14 Sep 2026 08:00:00 +0000", snippet: "Up to 40% off this week.", html: "<p>Up to <b>40%</b> off this week.</p>" },
    { id: "m8", threadId: "t8", labelIds: ["UNREAD", "Label_2"], from: "Acme Billing <billing@acme.example>", to: "someone@gmail.com", subject: "Your August invoice", date: "Sat, 15 Aug 2026 22:05:00 +0000", snippet: "Invoice 2026-08 is attached.", text: "Invoice 2026-08 is attached.", attachments: [{ filename: "invoice-2026-08.pdf", mimeType: "application/pdf", size: 47001 }] },
    { id: "m9", threadId: "t9", labelIds: ["SENT"], from: "someone@gmail.com", to: "Mara Lind <mara@example.com>", subject: "Re: Parser review before standup?", date: "Tue, 15 Sep 2026 10:00:00 +0000", snippet: "Sure, send it over.", text: "Sure, send it over.\nI have time tomorrow." },
    { id: "d1", threadId: "td1", labelIds: ["DRAFT"], from: "someone@gmail.com", to: "Ola Berg <ola@example.com>", subject: "Packing list", date: "Wed, 16 Sep 2026 07:00:00 +0000", snippet: "Boots, the good torch, cards.", text: "Boots, the good torch, cards." },
    { id: "d2", threadId: "td2", labelIds: ["DRAFT"], from: "someone@gmail.com", to: "", subject: "", date: "Tue, 15 Sep 2026 23:00:00 +0000", snippet: "", text: "" },
  ],
  drafts: [{ id: "r1", message: "d1" }, { id: "r2", message: "d2" }],
};

export const work: Box = {
  address: "someone@example.org",
  labels: [...SYSTEM, { id: "Label_10", name: "Reports", type: "user" }],
  messages: [
    { id: "w1", threadId: "wt1", labelIds: ["INBOX", "UNREAD", "Label_10"], from: "Terry Quinn <terry@example.org>", to: "someone@example.org", subject: "Weekly report: search latency", date: "Wed, 16 Sep 2026 09:30:00 +0000", snippet: "p95 is down 12% after the cache change.", text: "p95 is down 12% after the cache change." },
    { id: "w2", threadId: "wt2", labelIds: ["INBOX", "UNREAD"], from: "Dana Ruiz <dana@example.org>", to: "someone@example.org", subject: "Offsite dates", date: "Wed, 16 Sep 2026 08:00:00 +0000", snippet: "Two options: Oct 6-7 or Oct 13-14.", text: "Two options: Oct 6-7 or Oct 13-14." },
    { id: "w3", threadId: "wt3", labelIds: ["INBOX"], from: "Payroll <payroll@example.org>", to: "someone@example.org", subject: "September payslip", date: "Tue, 15 Sep 2026 06:00:00 +0000", snippet: "Your payslip is ready.", text: "Your payslip is ready.", attachments: [{ filename: "payslip.pdf", mimeType: "application/pdf", size: 30000 }] },
  ],
  drafts: [],
};

export type Seen = { method: string; path: string; auth: string | null; query: Record<string, string[]>; body?: unknown };

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
const err = (code: number, message: string, reason?: string) => json({ error: { code, message, errors: reason ? [{ reason }] : [], status: code === 429 ? "RESOURCE_EXHAUSTED" : "" } }, { status: code });

const headers = (m: Msg) => [
  { name: "From", value: m.from }, { name: "To", value: m.to }, ...(m.cc ? [{ name: "Cc", value: m.cc }] : []),
  { name: "Subject", value: m.subject }, { name: "Date", value: m.date }, ...(m.messageId ? [{ name: "Message-ID", value: m.messageId }] : []),
];
const parts = (m: Msg) => {
  const bodies = [
    ...(m.text !== undefined ? [{ partId: "0", mimeType: "text/plain", body: { size: m.text.length, data: b64url(m.text) } }] : []),
    ...(m.html !== undefined ? [{ partId: "1", mimeType: "text/html", body: { size: m.html.length, data: b64url(m.html) } }] : []),
  ];
  const att = (m.attachments ?? []).map((a, i) => ({ partId: `a${i}`, mimeType: a.mimeType, filename: a.filename, body: { size: a.size, attachmentId: `att${i}` } }));
  if (att.length) return { mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/alternative", parts: bodies }, ...att] };
  if (bodies.length > 1) return { mimeType: "multipart/alternative", parts: bodies };
  return bodies[0] ?? { mimeType: "text/plain", body: { size: 0 } };
};
const shape = (m: Msg, format: string) => ({
  id: m.id, threadId: m.threadId, labelIds: m.labelIds, snippet: m.snippet, internalDate: String(Date.parse(m.date)), sizeEstimate: 1000,
  payload: format === "full" ? { ...parts(m), headers: headers(m) } : { mimeType: parts(m).mimeType, headers: headers(m) },
});

/** A subset of Gmail's query language: `is:unread`, `is:starred`, `from:`, `to:`, `subject:`, `label:`, `in:`, `has:attachment`, `newer_than:`, bare words over the subject, the sender and the snippet. */
function matches(m: Msg, q: string): boolean {
  for (const tok of q.match(/(?:[a-z_]+:(?:"[^"]*"|\S+))|\S+/gi) ?? []) {
    const [k, ...rest] = tok.split(":");
    const v = rest.join(":").replace(/^"|"$/g, "").toLowerCase();
    const hay = `${m.subject} ${m.from} ${m.snippet}`.toLowerCase();
    if (rest.length === 0) { if (!hay.includes(tok.toLowerCase())) return false; continue; }
    switch (k.toLowerCase()) {
      case "is": if (v === "unread" ? !m.labelIds.includes("UNREAD") : v === "starred" ? !m.labelIds.includes("STARRED") : false) return false; break;
      case "from": if (!m.from.toLowerCase().includes(v)) return false; break;
      case "to": if (!m.to.toLowerCase().includes(v)) return false; break;
      case "subject": if (!m.subject.toLowerCase().includes(v)) return false; break;
      case "has": if (v === "attachment" && !(m.attachments?.length)) return false; break;
      case "in": if (!m.labelIds.map((l) => l.toLowerCase()).includes(v)) return false; break;
      case "label": { const id = current?.labels.find((l) => l.name.toLowerCase() === v)?.id; if (!id || !m.labelIds.includes(id)) return false; break; }
      case "newer_than": break;
      default: if (!hay.includes(tok.toLowerCase())) return false;
    }
  }
  return true;
}
let current: Box | undefined;

export class GmailMock {
  readonly seen: Seen[] = [];
  readonly sent: { raw: string; threadId?: string; box: string }[] = [];
  /** Token to box; a token not here is a 401. */
  tokens: Record<string, Box> = { "tok-personal": personal, "tok-work": work };
  limited = false;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly avatars: ReturnType<typeof Bun.serve>;
  /** The addresses Gravatar "knows" (the rest are 404). */
  known = new Set<string>(["mara@example.com", "terry@example.org"]);

  constructor() {
    this.server = Bun.serve({ port: 0, fetch: (req) => this.handle(req) });
    this.avatars = Bun.serve({
      port: 0,
      fetch: (req) => {
        const hash = new URL(req.url).pathname.slice(1);
        const hit = [...this.known].some((a) => new Bun.CryptoHasher("md5").update(a).digest("hex") === hash);
        return new Response(null, { status: hit ? 200 : 404 });
      },
    });
  }
  get url() { return `http://127.0.0.1:${this.server.port}`; }
  get avatarsUrl() { return `http://127.0.0.1:${this.avatars.port}`; }
  stop() { this.server.stop(true); this.avatars.stop(true); }
  calls(path: RegExp | string) { return this.seen.filter((s) => (typeof path === "string" ? s.path === path : path.test(s.path))); }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const query: Record<string, string[]> = {};
    for (const [k, v] of url.searchParams) (query[k] ??= []).push(v);
    const body = req.method === "POST" ? await req.json().catch(() => undefined) : undefined;
    const auth = req.headers.get("authorization");
    this.seen.push({ method: req.method, path: url.pathname, auth, query, body });
    if (this.limited) return new Response(JSON.stringify({ error: { code: 429, message: "Quota exceeded", errors: [{ reason: "rateLimitExceeded" }] } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } });
    const box = auth?.startsWith("Bearer ") ? this.tokens[auth.slice(7)] : undefined;
    if (!box) return err(401, "Request had invalid authentication credentials.", "authError");
    current = box;
    const p = url.pathname.replace(/^\/users\/me/, "");
    const q1 = (k: string) => query[k]?.[0];
    if (p === "/profile") return json({ emailAddress: box.address, messagesTotal: box.messages.length, threadsTotal: box.messages.length, historyId: "1" });
    if (p === "/labels") return json({ labels: box.labels.map((l) => ({ ...l, labelListVisibility: "labelShow", messageListVisibility: "show" })) });
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^\/labels\/([^/]+)$/))) {
      const l = box.labels.find((l) => l.id === decodeURIComponent(m![1]));
      if (!l) return err(404, "Requested entity was not found.", "notFound");
      const of = box.messages.filter((x) => x.labelIds.includes(l.id));
      return json({ ...l, messagesTotal: of.length, messagesUnread: of.filter((x) => x.labelIds.includes("UNREAD")).length, threadsUnread: of.filter((x) => x.labelIds.includes("UNREAD")).length });
    }
    if (p === "/messages/batchModify") {
      const { ids, addLabelIds = [], removeLabelIds = [] } = body as { ids: string[]; addLabelIds?: string[]; removeLabelIds?: string[] };
      for (const id of ids) {
        const x = box.messages.find((x) => x.id === id);
        if (!x) return err(404, `Requested entity was not found: ${id}`, "notFound");
        x.labelIds = [...x.labelIds.filter((l) => !removeLabelIds.includes(l)), ...addLabelIds.filter((l) => !x.labelIds.includes(l))];
      }
      return new Response(null, { status: 204 });
    }
    if (p === "/messages/send") {
      const { raw, threadId } = body as { raw: string; threadId?: string };
      this.sent.push({ raw, threadId, box: box.address });
      return json({ id: `sent${this.sent.length}`, threadId: threadId ?? `tsent${this.sent.length}`, labelIds: ["SENT"] });
    }
    if (p === "/messages" && req.method === "GET") {
      const labelIds = query.labelIds ?? [];
      const q = q1("q") ?? "";
      const max = Number(q1("maxResults") ?? 100);
      const hits = box.messages
        .filter((x) => !x.labelIds.includes("DRAFT") || labelIds.includes("DRAFT") || /in:draft/.test(q))
        .filter((x) => labelIds.every((l) => x.labelIds.includes(l)))
        .filter((x) => !q || matches(x, q))
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
        .slice(0, max);
      return json({ messages: hits.map((x) => ({ id: x.id, threadId: x.threadId })), resultSizeEstimate: hits.length });
    }
    if ((m = p.match(/^\/messages\/([^/]+)$/))) {
      const x = box.messages.find((x) => x.id === decodeURIComponent(m![1]));
      if (!x) return err(404, "Requested entity was not found.", "notFound");
      return json(shape(x, q1("format") ?? "full"));
    }
    if (p === "/drafts" && req.method === "GET") return json({ drafts: box.drafts.map((d) => ({ id: d.id, message: { id: d.message, threadId: box.messages.find((x) => x.id === d.message)?.threadId } })) });
    if (p === "/drafts/send") {
      const { id } = body as { id: string };
      const d = box.drafts.find((d) => d.id === id);
      if (!d) return err(404, "Requested entity was not found.", "notFound");
      box.drafts.splice(box.drafts.indexOf(d), 1);
      const x = box.messages.find((x) => x.id === d.message)!;
      x.labelIds = ["SENT"];
      this.sent.push({ raw: "", threadId: x.threadId, box: box.address });
      return json({ id: x.id, threadId: x.threadId, labelIds: ["SENT"] });
    }
    if ((m = p.match(/^\/drafts\/([^/]+)$/))) {
      const d = box.drafts.find((d) => d.id === decodeURIComponent(m![1]));
      if (!d) return err(404, "Requested entity was not found.", "notFound");
      if (req.method === "DELETE") { box.drafts.splice(box.drafts.indexOf(d), 1); return new Response(null, { status: 204 }); }
      return json({ id: d.id, message: shape(box.messages.find((x) => x.id === d.message)!, q1("format") ?? "full") });
    }
    return err(404, `no ${p}`, "notFound");
  }
}
