// MRP (the Media Remote Protocol) tunnelled over AirPlay 2: what is
// playing, its cover, and the transport with options (seek, skip by,
// shuffle, repeat). node-appletv-remote's `AirPlayConnection` does the
// AirPlay part (pair-verify, the event and data channels, the encrypted
// DataStream frames); this owns the MRP on top: the schema (protos.ts,
// inlined, since the library reads its .proto files from disk), the setup
// handshake and the decoding, so the library's own protobuf root and its
// console lines are never reached. Which player is "now playing" follows
// pyatv's `PlayerStateManager`: clients by bundle id, players inside them,
// the active one set by SetNowPlayingClient/Player.
import { AirPlayConnection, type HAPCredentials } from "node-appletv-remote";
import protobuf from "protobufjs";
import { PROTOS } from "./protos.ts";
import type { Chapter, Language, Lyrics, MediaCommand, NowPlaying, PlaybackState, QueueItem } from "../types.ts";

/** ProtocolMessage.Type values this module sends or reads (pyatv's numbering, a superset of the library's enum). */
export const T = {
  SendCommand: 1, SendCommandResult: 2, SetState: 4, DeviceInfo: 15, ClientUpdatesConfig: 16, Keyboard: 23, GetKeyboardSession: 24,
  PlaybackQueueRequest: 32, SetConnectionState: 38, SetNowPlayingClient: 46, SetNowPlayingPlayer: 47, VolumeDidChange: 52,
  RemoveClient: 53, RemovePlayer: 54, UpdateClient: 55, UpdateContentItem: 56, SetDefaultSupportedCommands: 72,
} as const;
const INNER: Record<number, string> = {
  [T.SetState]: ".setStateMessage", [T.UpdateContentItem]: ".updateContentItemMessage", [T.SetNowPlayingClient]: ".setNowPlayingClientMessage",
  [T.SetNowPlayingPlayer]: ".setNowPlayingPlayerMessage", [T.UpdateClient]: ".updateClientMessage", [T.RemoveClient]: ".removeClientMessage",
  [T.RemovePlayer]: ".removePlayerMessage", [T.SetDefaultSupportedCommands]: ".setDefaultSupportedCommandsMessage", [T.VolumeDidChange]: ".volumeDidChangeMessage",
  [T.Keyboard]: ".keyboardMessage", [T.DeviceInfo]: ".deviceInfoMessage",
};

const MISSING_TYPES = { SET_NOW_PLAYING_PLAYER_MESSAGE: T.SetNowPlayingPlayer, VOLUME_DID_CHANGE_MESSAGE: T.VolumeDidChange, REMOVE_CLIENT_MESSAGE: T.RemoveClient, REMOVE_PLAYER_MESSAGE: T.RemovePlayer, SET_DEFAULT_SUPPORTED_COMMANDS_MESSAGE: T.SetDefaultSupportedCommands };

/** MRP's `Command` numbers for the transport (CommandInfo.proto). */
export const Cmd = {
  play: 1, pause: 2, toggle: 3, stop: 4, next: 5, previous: 6, skip_forward: 18, skip_backward: 19, like: 22, dislike: 23,
  next_chapter: 25, previous_chapter: 26, seek: 45, repeat: 46, shuffle: 47,
} as const satisfies Record<MediaCommand, number>;
const COMMAND_OF = Object.fromEntries(Object.entries(Cmd).map(([k, v]) => [v, k as MediaCommand]));
/** The commands past the transport that take an option: a speed, a track, an item of the queue. */
export const Extra = { changeRate: 20, enableLanguage: 53, disableLanguage: 54, playItem: 57 } as const;
/** MPNowPlayingInfoLanguageOptionType, which MRP carries as is: 0 audible, 1 legible. */
const LEGIBLE = 1;

/** Queue requests of our own (the queue, the lyrics, a cover) are tagged so the answer does not replace the player's view of what plays. */
const SIDE = "pal-side-";

/** Seconds from the Unix epoch to Core Foundation's (2001-01-01), which MRP's timestamps count from. */
export const CF_EPOCH = 978307200;
const DEFAULT_PLAYER = "MediaRemote-DefaultPlayer";

let schemaP: Promise<protobuf.Root> | undefined;
/** The MRP schema from the inlined files; one root per process. */
export function schema(): Promise<protobuf.Root> {
  schemaP ??= (async () => {
    const root = new protobuf.Root();
    root.resolvePath = (_origin, target) => target.split("/").pop()!;
    // Answered on a later tick: `load` counts files in flight and finishes at zero, so a synchronous answer ends it after the first.
    // (`FetchCallback` types its error as required; protobufjs reads a null one as success.)
    root.fetch = (name: string, cb: protobuf.FetchCallback) => queueMicrotask(() => (name in PROTOS ? cb(null as unknown as Error, PROTOS[name]) : cb(new Error(`No MRP schema ${name}`))));
    await root.load(Object.keys(PROTOS), { keepCase: true });
    // proto2 enums are closed: a Type the library's list lacks would be dropped on decode, so pyatv's are added.
    const types = root.lookupEnum("ProtocolMessage.Type");
    for (const [name, id] of Object.entries(MISSING_TYPES)) if (!(name in types.values)) types.add(name, id);
    root.resolveAll();
    return root;
  })();
  return schemaP;
}

export type Msg = { type?: number; identifier?: string; [inner: string]: unknown };
type Obj = Record<string, any>;

/** A ProtocolMessage of `type`, its payload under the extension `key` (`sendCommandMessage`). */
export async function encode(type: number, key?: string, typeName?: string, fields?: object): Promise<Buffer> {
  const root = await schema();
  const PM = root.lookupType("ProtocolMessage");
  const body: Obj = { type, identifier: crypto.randomUUID().toUpperCase() };
  if (key && typeName) body[`.${key}`] = root.lookupType(typeName).fromObject(fields ?? {});
  return Buffer.from(PM.encode(PM.fromObject(body)).finish());
}

export async function decode(data: Uint8Array): Promise<Msg> {
  const PM = (await schema()).lookupType("ProtocolMessage");
  return PM.toObject(PM.decode(data), { longs: Number, enums: Number, defaults: false }) as Msg;
}

/** The SendCommand for a transport command, with the option it takes (seconds for seek and skip, a mode for shuffle and repeat). */
export function commandFields(command: MediaCommand, arg?: number): Obj {
  const options: Obj = {};
  if (command === "seek") options.playbackPosition = arg ?? 0;
  if (command === "skip_forward" || command === "skip_backward") options.skipInterval = arg ?? 10;
  if (command === "shuffle") options.shuffleMode = arg ?? 3;
  if (command === "repeat") options.repeatMode = arg ?? 3;
  return { command: Cmd[command], ...(Object.keys(options).length && { options }) };
}

// ---- player state (pyatv's PlayerStateManager) ------------------------------------------------

type Player = { id: string; name?: string; state?: number; commands: Obj[]; items: Obj[]; location: number; touched: number };
type Client = { bundle: string; name?: string; players: Map<string, Player>; active?: string; commands: Obj[] };

/** Which client and player is in front and what each holds, fed every MRP message. */
export class Players {
  private clients = new Map<string, Client>();
  private active?: string;
  private seq = 0;

  private client(c: Obj | undefined): Client {
    const bundle = String(c?.bundleIdentifier ?? "");
    let x = this.clients.get(bundle);
    if (!x) this.clients.set(bundle, (x = { bundle, players: new Map(), commands: [] }));
    if (c?.displayName) x.name = c.displayName;
    return x;
  }
  private player(path: Obj | undefined): Player {
    const c = this.client(path?.client);
    const id = String(path?.player?.identifier ?? DEFAULT_PLAYER);
    let p = c.players.get(id);
    if (!p) c.players.set(id, (p = { id, commands: [], items: [], location: 0, touched: 0 }));
    if (path?.player?.displayName) p.name = path.player.displayName;
    return p;
  }

  /** Folds one message in; true when what `nowPlaying` answers may have changed. */
  handle(msg: Msg): boolean {
    const inner = (msg[INNER[msg.type ?? -1] ?? ""] ?? {}) as Obj;
    switch (msg.type) {
      case T.SetState: {
        if (String(inner.request?.requestID ?? inner.playbackQueue?.requestId ?? "").startsWith(SIDE)) return false;
        const p = this.player(inner.playerPath);
        if (inner.playbackState !== undefined) p.state = inner.playbackState;
        if (inner.supportedCommands) p.commands = inner.supportedCommands.supportedCommands ?? [];
        if (inner.playbackQueue) { p.items = inner.playbackQueue.contentItems ?? []; p.location = inner.playbackQueue.location ?? 0; }
        p.touched = ++this.seq;
        return true;
      }
      case T.UpdateContentItem: {
        const p = this.player(inner.playerPath);
        for (const u of inner.contentItems ?? []) {
          const e = p.items.find((x) => x.identifier === u.identifier);
          if (!e) continue;
          e.metadata = { ...e.metadata, ...u.metadata };
          for (const k of ["artworkData", "info", "lyricsData", "sectionsData", "availableLanguageOptions", "currentLanguageOptions"]) if (u[k] !== undefined && !(Array.isArray(u[k]) && !u[k].length)) e[k] = u[k];
        }
        p.touched = ++this.seq;
        return true;
      }
      case T.SetNowPlayingClient: this.active = this.client(inner.client).bundle; return true;
      case T.SetNowPlayingPlayer: { const c = this.client(inner.playerPath?.client); c.active = this.player(inner.playerPath).id; return true; }
      case T.UpdateClient: this.client(inner.client); return true;
      case T.RemoveClient: { const b = String(inner.client?.bundleIdentifier ?? ""); this.clients.delete(b); if (this.active === b) this.active = undefined; return true; }
      case T.RemovePlayer: {
        const c = this.clients.get(String(inner.playerPath?.client?.bundleIdentifier ?? ""));
        const id = String(inner.playerPath?.player?.identifier ?? "");
        if (c) { c.players.delete(id); if (c.active === id) c.active = undefined; }
        return true;
      }
      case T.SetDefaultSupportedCommands: this.client(inner.playerPath?.client).commands = inner.supportedCommands?.supportedCommands ?? []; return true;
      default: return false;
    }
  }

  /** The client and player in front: the active client's active (or default) player; with no active client, the one heard from last. */
  current(): { client: Client; player: Player } | undefined {
    const c = this.active !== undefined ? this.clients.get(this.active) : undefined;
    if (c) {
      const p = (c.active && c.players.get(c.active)) || c.players.get(DEFAULT_PLAYER) || [...c.players.values()].sort((a, b) => b.touched - a.touched)[0];
      return p ? { client: c, player: p } : undefined;
    }
    let best: { client: Client; player: Player } | undefined;
    for (const client of this.clients.values()) for (const player of client.players.values()) if (!best || player.touched > best.player.touched) best = { client, player };
    return best;
  }

  /** What plays now, in the contract's shape (types.ts), or undefined when no app reported anything. */
  nowPlaying(): NowPlaying | undefined {
    const cur = this.current();
    if (!cur) return undefined;
    return toNowPlaying(cur.client, cur.player);
  }
}

/**
 * pyatv's `device_state`: a paused player without metadata is idle; playing at rate 0 stays playing, at a rate other than 1 is seeking.
 * One step past it: a player that sent an item but no state yet (the reply to the queue request on connect) reads its rate.
 */
function stateOf(p: Player, meta: Obj | undefined): PlaybackState {
  switch (p.state) {
    case undefined: case 0: return meta ? (meta.playbackRate ? "playing" : "paused") : "idle";
    case 1: return meta?.playbackRate !== undefined && meta.playbackRate !== 0 && Math.abs(meta.playbackRate - 1) > 1e-6 ? "seeking" : "playing";
    case 2: return meta ? "paused" : "idle";
    case 3: return "stopped";
    case 5: return "seeking";
    default: return "paused";
  }
}

export function toNowPlaying(client: { bundle: string; name?: string; commands: Obj[] }, p: Player): NowPlaying {
  const item = p.items[p.location];
  const m = item?.metadata as Obj | undefined;
  const info = (command: number) => [...p.commands, ...client.commands].find((c) => c.command === command);
  const shuffle = info(Cmd.shuffle)?.shuffleMode, repeat = info(Cmd.repeat)?.repeatMode;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const commands = [...p.commands, ...client.commands].filter((c) => c.enabled !== false && COMMAND_OF[c.command]).map((c) => COMMAND_OF[c.command]);
  const ts = num(m?.elapsedTimeTimestamp);
  const rate = info(Extra.changeRate);
  const rates = rate && rate.enabled !== false && rate.supportedRates?.length ? [...new Set<number>(rate.supportedRates.map((r: number) => Math.round(r * 100) / 100))].sort((a, b) => a - b) : undefined;
  const released = num(m?.releaseDate) !== undefined ? new Date((m!.releaseDate + CF_EPOCH) * 1000).toISOString().slice(0, 10) : m?.albumYear ? String(m.albumYear) : undefined;
  return {
    state: stateOf(p, m),
    title: m?.title || undefined,
    artist: m?.trackArtistName || m?.albumArtistName || undefined,
    album: m?.albumName || undefined,
    series: m?.seriesName || undefined,
    season: num(m?.seasonNumber),
    episode: num(m?.episodeNumber),
    mediaType: m?.mediaSubType === 4 ? "podcast" : m?.mediaSubType === 5 ? "audiobook" : m?.mediaType === 1 ? "music" : m?.mediaType === 2 ? (m?.seriesName ? "tv" : "video") : undefined,
    genre: m?.genre || undefined,
    duration: num(m?.duration),
    position: num(m?.elapsedTime),
    at: ts !== undefined ? Math.round((ts + CF_EPOCH) * 1000) : undefined,
    rate: num(m?.playbackRate),
    app: client.bundle ? { id: client.bundle, name: client.name } : undefined,
    shuffle: shuffle === 1 ? "off" : shuffle === 2 ? "albums" : shuffle === 3 ? "songs" : undefined,
    repeat: repeat === 1 ? "off" : repeat === 2 ? "one" : repeat === 3 ? "all" : undefined,
    itemId: item?.identifier || undefined,
    artworkAvailable: m?.artworkAvailable,
    commands: commands.length ? [...new Set(commands)] : undefined,
    description: item?.info || undefined,
    released,
    rating: m?.localizedContentRating || (m?.isExplicitItem ? "Explicit" : undefined),
    rates,
    chapters: chaptersOf(item),
    languages: languagesOf(item),
    liked: typeof m?.isLiked === "boolean" ? m.isLiked : undefined,
    hasLyrics: m?.lyricsAvailable || !!item?.lyricsData?.length || undefined,
  };
}

let typesP: Promise<{ item: protobuf.Type; lyrics: protobuf.Type; option: protobuf.Type }> | undefined;
let types: Awaited<NonNullable<typeof typesP>> | undefined;
/** The message types decoded by hand, loaded with the schema (sync use after `schema()` resolved once, which any message did). */
function loadTypes() {
  typesP ??= schema().then((r) => (types = { item: r.lookupType("ContentItem"), lyrics: r.lookupType("LyricsItem"), option: r.lookupType("LanguageOption") }));
  return typesP;
}
void loadTypes();
const tryDecode = <T,>(t: protobuf.Type | undefined, b: unknown): T | undefined => {
  if (!t || !(b instanceof Uint8Array) || !b.length) return undefined;
  try { return t.toObject(t.decode(b), { longs: Number, enums: Number, defaults: false }) as T; } catch { return undefined; }
};

/** The item's sections as chapters: each its own content item with a title, a start (or the running sum of the durations before it) and a length. */
export function chaptersOf(item: Obj | undefined): Chapter[] | undefined {
  const raw: unknown[] = item?.sectionsData ?? [];
  if (!raw.length) return undefined;
  let at = 0;
  const out: Chapter[] = [];
  for (const b of raw) {
    const sec = tryDecode<Obj>(types?.item, b);
    const m = sec?.metadata;
    if (!m) continue;
    const start = typeof m.startTime === "number" ? m.startTime : at;
    const duration = typeof m.duration === "number" ? m.duration : undefined;
    out.push({ title: m.title || `Chapter ${out.length + 1}`, start, ...(duration !== undefined && { duration }) });
    at = start + (duration ?? 0);
  }
  return out.length ? out : undefined;
}

const languageName = (o: Obj): string => {
  if (o.displayName) return o.displayName;
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(o.languageTag) ?? o.languageTag; } catch { return o.languageTag ?? "Unknown"; }
};
/** The legible/audible kind of an option: its characteristics (AVMediaCharacteristic), else its type. */
const isLegible = (o: Obj): boolean => (o.characteristics ?? []).includes("public.legible") || (!(o.characteristics ?? []).includes("public.audible") && o.type === LEGIBLE);

/** Audio and subtitle tracks from the option groups, the current ones marked; undefined when the app offers none. */
export function languagesOf(item: Obj | undefined): NowPlaying["languages"] {
  const groups: Obj[] = item?.availableLanguageOptions ?? [];
  if (!groups.length) return undefined;
  const current = new Set<string>((item?.currentLanguageOptions ?? []).map((o: Obj) => o.identifier));
  const audio: Language[] = [], subtitles: Language[] = [];
  for (const g of groups) for (const o of g.languageOptions ?? []) {
    if (!o.identifier) continue;
    (isLegible(o) ? subtitles : audio).push({ id: o.identifier, name: languageName(o), active: current.has(o.identifier) });
  }
  return audio.length || subtitles.length ? { audio, subtitles } : undefined;
}

/** A LanguageOption of the item by its identifier, as the app sent it (what Enable/DisableLanguageOption carry back). */
function optionOf(item: Obj | undefined, id: string): Obj | undefined {
  for (const g of item?.availableLanguageOptions ?? []) for (const o of g.languageOptions ?? []) if (o.identifier === id) return o;
  return (item?.currentLanguageOptions ?? []).find((o: Obj) => o.identifier === id);
}

/** TTML (`<p begin="00:01:02.500">`) or plain text as lines, timed when the times are there. */
export function parseLyrics(text: string): Lyrics | null {
  const t = text.trim();
  if (!t) return null;
  if (/<tt[\s>]/.test(t)) {
    const secs = (v: string) => { const p = v.replace(/s$/, "").split(":").map(Number); return p.reduce((a, x) => a * 60 + x, 0); };
    const unescape = (v: string) => v.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").trim();
    const lines = [...t.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)].map(([, attrs, body]) => {
      const begin = /\bbegin="([^"]+)"/.exec(attrs)?.[1];
      return { ...(begin && { at: secs(begin) }), text: unescape(body) };
    }).filter((l) => l.text);
    return lines.length ? { lines } : null;
  }
  return { lines: t.split(/\r?\n/).map((text) => ({ text: text.trim() })) };
}

/** A queue answer's items in the contract's shape. */
export function queueItems(items: Obj[]): QueueItem[] {
  return items.map((it) => {
    const m = it.metadata ?? {};
    const art = it.artworkData instanceof Uint8Array && it.artworkData.length ? it.artworkData : undefined;
    return {
      id: String(it.identifier ?? ""),
      title: m.title || undefined, artist: m.trackArtistName || m.albumArtistName || undefined, series: m.seriesName || undefined,
      season: typeof m.seasonNumber === "number" ? m.seasonNumber : undefined, episode: typeof m.episodeNumber === "number" ? m.episodeNumber : undefined,
      duration: typeof m.duration === "number" ? m.duration : undefined, ...(art && { artwork: art }),
    };
  }).filter((q) => q.id);
}

// ---- the link ---------------------------------------------------------------------------------

/** The AirPlay connection's internals this module drives: its own MRP setup and decoding replace the library's. */
type Internals = {
  log: (msg: string) => void;
  initMRPProtocol: () => Promise<void>;
  handleMRPResponse: (data: Buffer) => Promise<void>;
  pendingMRPResolvers: { type?: number; resolve: (m: unknown) => void }[];
  dataSocket?: import("node:net").Socket;
};

/** One MRP session over AirPlay. `onMessage` hears every decoded message; `onClose` once, when any of its sockets goes. */
export class MrpLink {
  readonly players = new Players();
  private conn: AirPlayConnection;
  private listeners = new Set<(m: Msg) => void>();
  private closers = new Set<(error?: Error) => void>();
  closed = false;

  constructor(readonly host: string, readonly port: number, creds: HAPCredentials, private readonly name = "pal") {
    this.conn = new AirPlayConnection(host, port, creds);
    const c = this.conn as unknown as Internals;
    c.log = process.env.PAL_APPLETV_DEBUG ? (m) => console.error(`[appletv] airplay: ${m}`) : () => {};
    c.initMRPProtocol = () => this.setup(creds.clientId);
    c.handleMRPResponse = (data) => this.received(data);
    this.conn.on("close", () => this.shut(new Error("The Apple TV closed the AirPlay connection")));
    this.conn.on("error", () => {});
  }

  async open(): Promise<void> {
    await this.conn.connect();
    (this.conn as unknown as Internals).dataSocket?.on("close", () => this.shut(new Error("The Apple TV closed the media channel")));
    // Ask for what plays now; the reply is a SetState like any update.
    await this.enrich();
  }

  private enriched?: string;
  /**
   * What plays, asked in full (the description, the audio and subtitle
   * tracks, the chapters): an app's own updates often carry only the basics.
   * Asked on connect and again once per new item.
   */
  private async enrich(): Promise<void> {
    this.enriched = this.item()?.identifier;
    await this.send(await encode(T.PlaybackQueueRequest, "playbackQueueRequestMessage", "PlaybackQueueRequestMessage", { location: 0, length: 1, includeMetadata: true, artworkWidth: 0, artworkHeight: 0, includeLyrics: false, includeSections: true, includeInfo: true, includeLanguageOptions: true }));
  }

  /** pyatv's MRP setup over AirPlay: DeviceInfo (answered), the connection state, the updates wanted, the keyboard session. */
  private async setup(clientId: string): Promise<void> {
    const info = this.waitFor((m) => m.type === T.DeviceInfo, 5000);
    await this.send(await encode(T.DeviceInfo, "deviceInfoMessage", "DeviceInfoMessage", {
      uniqueIdentifier: clientId, name: this.name, localizedModelName: "iPhone", systemBuildVersion: "18G82", applicationBundleIdentifier: "com.apple.TVRemote",
      applicationBundleVersion: "344.28", protocolVersion: 1, lastSupportedMessageType: 108, supportsSystemPairing: true, allowsPairing: true,
      systemMediaApplication: "com.apple.TVMusic", supportsACL: true, supportsSharedQueue: true, sharedQueueVersion: 2, supportsExtendedMotion: true,
    }));
    await info;
    await this.send(await encode(T.SetConnectionState, "setConnectionStateMessage", "SetConnectionStateMessage", { state: 2 }));
    await this.send(await encode(T.ClientUpdatesConfig, "clientUpdatesConfigMessage", "ClientUpdatesConfigMessage", { artworkUpdates: true, nowPlayingUpdates: true, volumeUpdates: true, keyboardUpdates: true }));
    await this.send(await encode(T.GetKeyboardSession));
  }

  private async received(data: Buffer): Promise<void> {
    let msg: Msg;
    try { msg = await decode(data); } catch { return; }
    this.players.handle(msg);
    const id = this.item()?.identifier;
    if (msg.type === T.SetState && id && id !== this.enriched && !this.closed) this.enrich().catch(() => {});
    for (const l of this.listeners) l(msg);
    // The library's own waiters (DeviceInfo during connect) still resolve.
    const pending = (this.conn as unknown as Internals).pendingMRPResolvers;
    const i = pending.findIndex((r) => r.type === undefined || r.type === msg.type);
    if (i >= 0) pending.splice(i, 1)[0].resolve(msg);
  }

  send(data: Buffer): Promise<void> {
    if (this.closed) return Promise.reject(new Error("The media channel is closed"));
    return this.conn.sendMRPMessage(data);
  }

  /** The next message `pred` accepts, or a rejection after `ms`. */
  waitFor(pred: (m: Msg) => boolean, ms: number): Promise<Msg> {
    return new Promise((resolve, reject) => {
      const off = this.onMessage((m) => { if (pred(m)) { clearTimeout(timer); off(); resolve(m); } });
      const timer = setTimeout(() => { off(); reject(new Error("The Apple TV did not answer in time")); }, ms);
    });
  }

  async command(command: MediaCommand, arg?: number): Promise<void> {
    await this.send(await encode(T.SendCommand, "sendCommandMessage", "SendCommandMessage", commandFields(command, arg)));
  }

  /**
   * A queue request of our own, tagged (`SIDE`) so its answer does not replace
   * what the players hold, and matched back by its id (or, when the box does
   * not echo it, by the request it echoes): the items it answers with.
   */
  private async side(fields: Obj, ms = 3000): Promise<Obj[]> {
    // Nothing loaded: nothing to ask about, and the box would not answer.
    if (!this.item()) return [];
    const id = `${SIDE}${crypto.randomUUID()}`;
    const req = { location: 0, length: 1, includeMetadata: true, artworkWidth: 0, artworkHeight: 0, includeLyrics: false, includeSections: false, includeInfo: false, includeLanguageOptions: false, ...fields, requestID: id };
    const answers = (m: Msg) => {
      if (m.type !== T.SetState) return false;
      const st = m[".setStateMessage"] as Obj | undefined;
      const r = st?.request;
      return r?.requestID === id || st?.playbackQueue?.requestId === id || (!!r && r.requestID === undefined && r.location === req.location && r.length === req.length && (r.artworkWidth ?? 0) === req.artworkWidth && !!r.includeLyrics === req.includeLyrics);
    };
    const reply = this.waitFor(answers, ms).catch(() => undefined);
    await this.send(await encode(T.PlaybackQueueRequest, "playbackQueueRequestMessage", "PlaybackQueueRequestMessage", req));
    const m = await reply;
    return ((m?.[".setStateMessage"] as Obj | undefined)?.playbackQueue?.contentItems ?? []) as Obj[];
  }

  /** The item playing as the players hold it (its raw options, lyrics bytes). */
  private item(): Obj | undefined {
    const cur = this.players.current();
    return cur?.player.items[cur.player.location];
  }

  /** The cover of what plays, at that size, or null when the app has none. */
  async artwork(width: number, height: number): Promise<Uint8Array | null> {
    const data = (await this.side({ artworkWidth: width, artworkHeight: height }))[0]?.artworkData;
    return data instanceof Uint8Array && data.length ? data : null;
  }

  /** The next `count` items after the one playing, each with its cover at `artwork` px when asked. */
  async queue(count: number, artwork = 0): Promise<QueueItem[]> {
    await loadTypes();
    const items = await this.side({ location: 1, length: count, artworkWidth: artwork, artworkHeight: artwork, includeInfo: true });
    const now = this.item()?.identifier;
    return queueItems(items.filter((i) => i.identifier !== now)).slice(0, count);
  }

  /** The lyrics of what plays: the item's own when it came with them, else asked for. */
  async lyrics(): Promise<Lyrics | null> {
    await loadTypes();
    let raw = this.item()?.lyricsData;
    if (!(raw instanceof Uint8Array) || !raw.length) raw = (await this.side({ includeLyrics: true }))[0]?.lyricsData;
    const l = tryDecode<Obj>(types?.lyrics, raw);
    return l?.lyrics ? parseLyrics(l.lyrics) : null;
  }

  /** A command past the transport, with its options. */
  private async extra(command: number, options: Obj): Promise<void> {
    await this.send(await encode(T.SendCommand, "sendCommandMessage", "SendCommandMessage", { command, options }));
  }

  /** An audio or subtitle track by its id; `null` turns the subtitles off (the active legible option disabled). */
  async setLanguage(kind: "audio" | "subtitles", id: string | null): Promise<void> {
    const { option } = await loadTypes();
    const item = this.item();
    const enc = (o: Obj) => Buffer.from(option.encode(option.fromObject(o)).finish());
    if (id === null) {
      if (kind !== "subtitles") throw new Error("There is always an audio track");
      const on = (item?.currentLanguageOptions ?? []).find(isLegible);
      if (on) await this.extra(Extra.disableLanguage, { languageOption: enc(on) });
      return;
    }
    const o = optionOf(item, id);
    if (!o) throw new Error("That track is not offered any more");
    await this.extra(Extra.enableLanguage, { languageOption: enc(o) });
  }

  /** Playback speed, one the app offers. */
  async setRate(rate: number): Promise<void> { await this.extra(Extra.changeRate, { playbackRate: rate }); }

  /** Jump to an item of the queue by its identifier. */
  async playQueueItem(id: string): Promise<void> { await this.extra(Extra.playItem, { contentItemID: id }); }

  onMessage(fn: (m: Msg) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onClose(fn: (error?: Error) => void): () => void { this.closers.add(fn); return () => this.closers.delete(fn); }

  private shut(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.conn.close();
    for (const c of this.closers) c(error);
  }

  close(): void { this.shut(); }
}
