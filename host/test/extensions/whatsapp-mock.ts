// A Bun mock of the OpenWA HTTP API for whatsapp.test.ts and the
// screenshot fixture: one session named `main` (its UUID is what the
// session routes take), a chat list in OpenWA's shape (bare list,
// `lastMessage` a string, `timestamp` in seconds), the live history of a
// chat (`fromMe`, oldest first, no names) and the archive's rows for it
// (`direction`, `chatName`, a quoted reply under `metadata`), the
// contacts store paged, the LID-to-phone route, profile pictures (SVG
// initials served here for the ids it knows), the full-text search with
// `<mark>` snippets, and the four writes recorded (mark read, mark
// unread, send-text, reply, react). `x-api-key` must be `k-test`, else a
// 401; `limited` answers 429 with Retry-After 1; `searchDown` answers the
// 503 the owner's wsearch gave on 2026-09-17; `status` other than `ready`
// makes the chat list answer 409 as the live gateway does while it waits
// for a QR scan. The people and messages are invented.
export type MockChat = { id: string; name: string; group: boolean; unread: number; at: number; last?: string | null; phone?: string; picture?: boolean };
export type MockMsg = { id: string; chatId: string; fromMe: boolean; author?: string; body: string; type: string; at: number; chatName?: string; quoted?: string };
export type MockContact = { id: string; name?: string; pushName?: string; number: string; isMyContact: boolean };

export const SESSION_ID = "0f3b7c2e-1111-4a5b-9c8d-0123456789ab";
export const KEY = "k-test";

/** "Now" for the fixture, in seconds: the newest message is two minutes old whenever the mock runs, so the screenshots read as live. */
export const T0 = Math.floor(Date.now() / 60_000) * 60;
export const m = (mins: number) => T0 - mins * 60;

export const chats: MockChat[] = [
  { id: "254011223344556@lid", name: "Mara Lind", group: false, unread: 3, at: m(2), last: null, phone: "905551234567", picture: true },
  { id: "120363012345678901@g.us", name: "Weekend hike", group: true, unread: 5, at: m(9), last: null, picture: true },
  { id: "905559876543@c.us", name: "Tomas Ruiz", group: false, unread: 1, at: m(31), last: "the cabin is booked, sending the map", picture: false },
  { id: "120363099887766554@g.us", name: "Family", group: true, unread: 0, at: m(75), last: "Dinner at eight on Sunday?", picture: false },
  { id: "905551112233@c.us", name: "Ola Berg", group: false, unread: 0, at: m(130), last: "Thanks, got it", picture: true },
  { id: "301122334455667@lid", name: "Lina Kova", group: false, unread: 0, at: m(26 * 60), last: "see you friday", phone: "905553334455", picture: false },
  { id: "120363055544433322@g.us", name: "pal beta", group: true, unread: 0, at: m(50 * 60), last: null, picture: false },
  { id: "905557778899@c.us", name: "Acme Support", group: false, unread: 0, at: m(4 * 24 * 60), last: "Your ticket #4471 is closed", picture: false },
  { id: "status@broadcast", name: "Status", group: false, unread: 0, at: m(1), last: null },
];

/** Live histories, oldest first, per chat; the archive holds the same rows with names and quotes. */
export const messages: MockMsg[] = [
  { id: "false_254011223344556@lid_A1", chatId: "254011223344556@lid", fromMe: false, body: "can you look at the parser before standup?", type: "text", at: m(40) },
  { id: "true_254011223344556@lid_A2", chatId: "254011223344556@lid", fromMe: true, body: "on it, give me ten", type: "text", at: m(35) },
  { id: "false_254011223344556@lid_A3", chatId: "254011223344556@lid", fromMe: false, body: "", type: "image", at: m(12) },
  { id: "false_254011223344556@lid_A4", chatId: "254011223344556@lid", fromMe: false, body: "the tests are green now, the diff is small", type: "text", at: m(3), quoted: "on it, give me ten" },
  { id: "false_254011223344556@lid_A5", chatId: "254011223344556@lid", fromMe: false, body: "standup in 20?", type: "text", at: m(2) },
  { id: "false_120363012345678901@g.us_B1", chatId: "120363012345678901@g.us", fromMe: false, author: "905551112233@c.us", body: "who is in for saturday?", type: "text", at: m(60), chatName: "Ola Berg" },
  { id: "true_120363012345678901@g.us_B2", chatId: "120363012345678901@g.us", fromMe: true, body: "me, if we start before nine", type: "text", at: m(55) },
  { id: "false_120363012345678901@g.us_B3", chatId: "120363012345678901@g.us", fromMe: false, author: "905559876543@c.us", body: "", type: "ptt", at: m(30), chatName: "Tomas Ruiz" },
  { id: "false_120363012345678901@g.us_B4", chatId: "120363012345678901@g.us", fromMe: false, author: "301122334455667@lid", body: "trailhead at 8:30 then", type: "text", at: m(20), chatName: "Lina Kova", quoted: "me, if we start before nine" },
  { id: "false_120363012345678901@g.us_B5", chatId: "120363012345678901@g.us", fromMe: false, author: "905551112233@c.us", body: "", type: "location", at: m(9), chatName: "Ola Berg" },
  { id: "false_905559876543@c.us_C1", chatId: "905559876543@c.us", fromMe: false, body: "the cabin is booked, sending the map", type: "text", at: m(31) },
  { id: "true_120363099887766554@g.us_D1", chatId: "120363099887766554@g.us", fromMe: true, body: "Dinner at eight on Sunday?", type: "text", at: m(75) },
  { id: "false_905551112233@c.us_E1", chatId: "905551112233@c.us", fromMe: false, body: "Thanks, got it", type: "text", at: m(130) },
  { id: "false_301122334455667@lid_F1", chatId: "301122334455667@lid", fromMe: false, body: "see you friday", type: "text", at: m(26 * 60) },
  { id: "false_905557778899@c.us_G1", chatId: "905557778899@c.us", fromMe: false, body: "Your ticket #4471 is closed", type: "text", at: m(4 * 24 * 60) },
  { id: "true_905557778899@c.us_G0", chatId: "905557778899@c.us", fromMe: true, body: "the invoice for september is missing the parser line", type: "text", at: m(5 * 24 * 60) },
];

export const contacts: MockContact[] = [
  { id: "905551234567@c.us", name: "Mara Lind", pushName: "mara", number: "905551234567", isMyContact: true },
  { id: "905559876543@c.us", name: "Tomas Ruiz", number: "905559876543", isMyContact: true },
  { id: "905551112233@c.us", name: "Ola Berg", number: "905551112233", isMyContact: true },
  { id: "905553334455@c.us", name: "Lina Kova", number: "905553334455", isMyContact: true },
  { id: "905557778899@c.us", name: "Acme Support", number: "905557778899", isMyContact: true },
  { id: "905550001122@c.us", name: "Dana Ruiz", number: "905550001122", isMyContact: true },
  { id: "905558889900@c.us", name: "?", number: "905558889900", isMyContact: true },
  { id: "905552223344@c.us", name: "+90 555 222 33 44", number: "905552223344", isMyContact: true },
  { id: "301122334455667@lid", name: "Lina Kova", number: "301122334455667", isMyContact: true },
  { id: "905554445566@c.us", pushName: "someone", number: "905554445566", isMyContact: false },
  { id: "905556667788@c.us", number: "905556667788", isMyContact: false },
];

export type Seen = { method: string; path: string; key: string | null; query: Record<string, string>; body?: unknown };

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
const err = (statusCode: number, message: string, error = "Error") => json({ message, error, statusCode }, { status: statusCode });
const mark = (text: string, q: string) => text.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<mark>$1</mark>");

export class WhatsAppMock {
  readonly seen: Seen[] = [];
  readonly sent: { chatId: string; text: string; quoted?: string }[] = [];
  readonly reacted: { chatId: string; messageId: string; emoji: string }[] = [];
  readonly read: string[] = [];
  readonly unread: string[] = [];
  limited = false;
  searchDown = false;
  status: string = "ready";
  /** The chat list served: a test may swap it. */
  chats: MockChat[] = chats.map((c) => ({ ...c }));
  readonly server: ReturnType<typeof Bun.serve>;

  constructor() {
    this.server = Bun.serve({ port: 0, fetch: (req) => this.handle(req) });
  }
  get url() { return `http://127.0.0.1:${this.server.port}`; }
  stop() { this.server.stop(true); }
  calls(path: RegExp | string) { return this.seen.filter((s) => (typeof path === "string" ? s.path === path : path.test(s.path))); }
  chat(id: string) { return this.chats.find((c) => c.id === id); }

  private picture(id: string): Response {
    const c = this.chats.find((c) => c.id === id);
    const letter = (c?.name ?? "?")[0].toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#128c7e"/><text x="32" y="42" font-family="system-ui" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
    return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // The pictures are served without the key: they stand in for pps.whatsapp.net.
    let pm: RegExpMatchArray | null;
    if ((pm = url.pathname.match(/^\/pic\/(.+)\.svg$/))) return this.picture(decodeURIComponent(pm[1]));
    const query = Object.fromEntries(url.searchParams);
    const body = req.method === "POST" ? await req.json().catch(() => undefined) : undefined;
    const key = req.headers.get("x-api-key");
    this.seen.push({ method: req.method, path: url.pathname, key, query, body });
    if (this.limited) return new Response(JSON.stringify({ message: "ThrottlerException: Too Many Requests", error: "Too Many Requests", statusCode: 429 }), { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } });
    if (key !== KEY) return err(401, "Invalid API key", "Unauthorized");
    const p = url.pathname.replace(/^\/api/, "");
    if (p === "/sessions") return json([{ id: SESSION_ID, name: "main", status: this.status, phone: "905550000000", pushName: "sam", createdAt: "2026-07-27T10:00:00.000Z", updatedAt: "2026-09-17T06:00:00.000Z" }]);
    if (p === "/search") {
      if (this.searchDown) return err(503, "wsearch /search -> 500 Internal Server Error", "Service Unavailable");
      const q = (query.q ?? "").trim();
      if (!q) return err(400, "q is required", "Bad Request");
      const limit = Number(query.limit ?? 50);
      const hits = messages.filter((x) => x.body.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.at - a.at).slice(0, limit).map((x) => ({
        messageId: `row-${x.id}`, waMessageId: x.id, sessionId: SESSION_ID, chatId: x.chatId, body: x.body, snippet: mark(x.body, q), timestamp: x.at, type: x.type, direction: x.fromMe ? "outgoing" : "incoming", from: x.fromMe ? "905550000000@c.us" : x.author ?? x.chatId, score: 0.5,
      }));
      return json({ hits, total: hits.length, tookMs: 3, provider: "builtin-fts" });
    }
    let sm: RegExpMatchArray | null;
    if (!(sm = p.match(/^\/sessions\/([^/]+)(.*)$/))) return err(404, `Cannot ${req.method} ${url.pathname}`, "Not Found");
    if (sm[1] !== SESSION_ID) return err(404, `Session ${sm[1]} not found`, "Not Found");
    const sub = sm[2];
    if (sub === "/chats") {
      if (this.status !== "ready") return err(409, `Session is not ready (status: ${this.status})`, "Conflict");
      return json(this.chats.map((c) => ({ id: c.id, name: c.name, isGroup: c.group, kind: c.id === "status@broadcast" ? "status" : c.group ? "group" : "individual", unreadCount: c.unread, timestamp: c.at, ...(c.last !== undefined && { lastMessage: c.last }) })));
    }
    if (sub === "/chats/read" || sub === "/chats/unread") {
      const { chatId } = body as { chatId: string };
      const c = this.chat(chatId);
      if (!c) return err(404, `Chat ${chatId} not found`, "Not Found");
      if (sub === "/chats/read") { this.read.push(chatId); c.unread = 0; } else { this.unread.push(chatId); c.unread = Math.max(1, c.unread); }
      return json({ success: true });
    }
    let mm: RegExpMatchArray | null;
    if ((mm = sub.match(/^\/messages\/([^/]+)\/history$/))) {
      const chatId = decodeURIComponent(mm[1]);
      if (!this.chat(chatId)) return err(500, "Internal error", "Internal Server Error");
      const limit = Number(query.limit ?? 50);
      const rows = messages.filter((x) => x.chatId === chatId).sort((a, b) => a.at - b.at).slice(-limit);
      return json(rows.map((x) => ({ id: x.id, from: x.fromMe ? "905550000000@c.us" : chatId.endsWith("@g.us") ? chatId : x.chatId, to: x.fromMe ? x.chatId : "905550000000@c.us", chatId: x.chatId, body: x.body, type: x.type, timestamp: x.at, fromMe: x.fromMe, isGroup: chatId.endsWith("@g.us"), kind: chatId.endsWith("@g.us") ? "group" : "individual", isStatusBroadcast: false, ...(x.author && { author: x.author, isLidSender: x.author.endsWith("@lid") }) })));
    }
    if (sub === "/messages" && req.method === "GET") {
      const chatId = query.chatId;
      const limit = Math.min(Number(query.limit ?? 50), 100);
      const rows = messages.filter((x) => !chatId || x.chatId === chatId).sort((a, b) => b.at - a.at).slice(0, limit);
      return json({ messages: rows.map((x) => ({ id: `row-${x.id}`, sessionId: SESSION_ID, waMessageId: x.id, chatId: x.chatId, chatName: x.chatName ?? this.chat(x.chatId)?.name, author: x.author ?? null, from: x.fromMe ? "905550000000@c.us" : x.chatId, to: x.fromMe ? x.chatId : "905550000000@c.us", body: x.body, type: x.type, direction: x.fromMe ? "outgoing" : "incoming", timestamp: x.at, metadata: x.quoted ? { quotedMessage: { id: "q", body: x.quoted } } : null, status: "sent", createdAt: new Date(x.at * 1000).toISOString() })) });
    }
    if (sub === "/messages/send-text" || sub === "/messages/reply") {
      const { chatId, text, quotedMessageId } = body as { chatId: string; text: string; quotedMessageId?: string };
      if (!this.chat(chatId)) return err(404, `Chat ${chatId} not found`, "Not Found");
      if (!text?.trim()) return err(400, "text should not be empty", "Bad Request");
      this.sent.push({ chatId, text, ...(quotedMessageId && { quoted: quotedMessageId }) });
      return json({ messageId: `true_${chatId}_S${this.sent.length}`, timestamp: T0 }, { status: 201 });
    }
    if (sub === "/messages/react") {
      const { chatId, messageId, emoji } = body as { chatId: string; messageId: string; emoji: string };
      if (!messages.some((x) => x.id === messageId)) return err(404, `Message ${messageId} not found`, "Not Found");
      this.reacted.push({ chatId, messageId, emoji });
      return json({ success: true }, { status: 201 });
    }
    if (sub === "/contacts") {
      const offset = Number(query.offset ?? 0), limit = Number(query.limit ?? 1000);
      return json(contacts.slice(offset, offset + limit).map((c) => ({ ...c, isBlocked: false })));
    }
    if (sub === "/contacts/profile-pictures") {
      const ids = (query.ids ?? "").split(",").filter(Boolean).slice(0, 50);
      return json({ pictures: Object.fromEntries(ids.map((id) => [id, this.chat(id)?.picture ? `${this.url}/pic/${encodeURIComponent(id)}.svg` : null])) });
    }
    let cm: RegExpMatchArray | null;
    if ((cm = sub.match(/^\/contacts\/([^/]+)\/phone$/))) {
      const id = decodeURIComponent(cm[1]);
      const phone = this.chat(id)?.phone ?? contacts.find((c) => c.id === id)?.number;
      if (!phone || !id.endsWith("@lid")) return err(404, `No phone for ${id}`, "Not Found");
      return json({ contactId: id, phone });
    }
    if ((cm = sub.match(/^\/contacts\/([^/]+)$/))) {
      const id = decodeURIComponent(cm[1]);
      const c = contacts.find((c) => c.id === id) ?? (this.chat(id)?.phone ? contacts.find((c) => c.number === this.chat(id)!.phone) : undefined);
      if (!c) return err(404, `Contact ${id} not found`, "Not Found");
      return json({ id: c.id, name: c.name, pushName: c.pushName, number: c.number, isMyContact: c.isMyContact, isBlocked: false });
    }
    return err(404, `Cannot ${req.method} ${url.pathname}`, "Not Found");
  }
}
