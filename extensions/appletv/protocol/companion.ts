// The Companion link (`_companion-link._tcp`), what the iPhone's Remote
// uses: one TCP socket, HAP pair-verify with the keys from pairing, then
// ChaCha20-Poly1305 frames of OPACK dicts: requests (`_t` 2) answered by
// `_x`, events (`_t` 1) pushed. A port of pyatv's companion connection,
// protocol and api.py: the session handshake, HID buttons and touch, media
// control, apps, accounts, power and the RTI text session. Pairing itself
// is node-appletv-remote's `CompanionPairSetup` (device.ts); its post-pairing
// transport is not used: it counts the frame length without the tag and
// puts the nonce counter at byte 4, so the Apple TV drops every request.
import { createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, randomInt, sign, verify } from "node:crypto";
import { Socket } from "node:net";
import { decryptChaCha20, encryptChaCha20, hkdfSha512 } from "node-appletv-remote/dist/util/crypto.js";
import { TlvTag, tlvDecode, tlvEncode } from "node-appletv-remote/dist/util/tlv.js";
import { pack, unpack } from "./opack.ts";
import type { Credentials } from "../types.ts";

export const Frame = { PV_Start: 5, PV_Next: 6, E_OPACK: 8 } as const;
const TAG = 16;
const TIMEOUT_MS = 5000;

/** pyatv's `HidCommand`. */
export const Hid = { up: 1, down: 2, left: 3, right: 4, menu: 5, select: 6, home: 7, volume_up: 8, volume_down: 9, siri: 10, screensaver: 11, sleep: 12, wake: 13, play_pause: 14, channel_up: 15, channel_down: 16, guide: 17, page_up: 18, page_down: 19 } as const;
/** pyatv's `MediaControlCommand` (`_mcc`). */
export const Mcc = { play: 1, pause: 2, next: 3, previous: 4, getVolume: 5, setVolume: 6, skipBy: 7, fastForwardBegin: 8, fastForwardEnd: 9, rewindBegin: 10, rewindEnd: 11, getCaptions: 12, setCaptions: 13 } as const;
/** `_iMC`'s `_mcF` bits: what media control the box offers right now. */
export const McFlags = { play: 0x1, pause: 0x2, previous: 0x4, next: 0x8, fastForward: 0x10, rewind: 0x20, volume: 0x100, skipForward: 0x200, skipBackward: 0x400 } as const;
/** `FetchAttentionState` / `SystemStatus`: 1 asleep, 2 screensaver, 3 awake, 4 idle. */
export const Attention = { asleep: 1, screensaver: 2, awake: 3, idle: 4 } as const;

export type Dict = Record<string, unknown>;

/** A Companion request the Apple TV refused (`_em`), or did not answer. */
export class CompanionError extends Error {}

/** The 12-byte nonce: the counter little-endian from byte 0 (pyatv's `Chacha20Cipher(nonce_length=12)`). */
export const nonce = (n: bigint) => { const b = Buffer.alloc(12); b.writeBigUInt64LE(n, 0); return b; };

/** One direction's cipher; the frame header (with the tag counted in its length) is the AAD. */
export class Cipher {
  private n = 0n;
  constructor(private readonly key: Buffer) {}
  seal(type: number, plain: Buffer): Buffer {
    const header = frameHeader(type, plain.length + TAG);
    const { ciphertext, tag } = encryptChaCha20(this.key, nonce(this.n++), plain, header);
    return Buffer.concat([header, ciphertext, tag]);
  }
  open(header: Buffer, body: Buffer): Buffer {
    return decryptChaCha20(this.key, nonce(this.n++), body.subarray(0, -TAG), body.subarray(-TAG), header);
  }
}

export const frameHeader = (type: number, len: number) => Buffer.from([type, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);

const hex = (s: string) => Buffer.from(s, "hex");
const ed25519Private = (seed: Buffer) => createPrivateKey({ key: Buffer.concat([hex("302e020100300506032b657004220420"), seed]), format: "der", type: "pkcs8" });
const ed25519Public = (raw: Buffer) => createPublicKey({ key: Buffer.concat([hex("302a300506032b6570032100"), raw]), format: "der", type: "spki" });
const x25519Public = (raw: Buffer) => createPublicKey({ key: Buffer.concat([hex("302a300506032b656e032100"), raw]), format: "der", type: "spki" });
const pvNonce = (msg: string) => { const b = Buffer.alloc(12); b.write(msg, 4); return b; };

type Pending = { resolve: (d: Dict) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/**
 * One encrypted Companion socket. `request` sends `_t` 2 and resolves with
 * the response's `_c`; `event` sends `_t` 1; `onEvent` hears pushes by `_i`.
 */
export class CompanionLink {
  private socket?: Socket;
  private buf: Buffer = Buffer.alloc(0);
  private out?: Cipher;
  private in?: Cipher;
  private xid = randomInt(0, 0x10000);
  private pending = new Map<number, Pending>();
  /** The pair-verify step waiting for its PV_Next reply. */
  private auth?: { resolve: (d: Dict) => void; reject: (e: Error) => void };
  private listeners = new Set<(id: string, content: Dict) => void>();
  private closers = new Set<(error?: Error) => void>();
  closed = false;

  constructor(readonly host: string, readonly port: number, private readonly creds: Credentials) {}

  async open(timeoutMs = TIMEOUT_MS): Promise<void> {
    const socket = new Socket();
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new CompanionError(`${this.host} did not answer`)); }, timeoutMs);
      socket.once("error", (e) => { clearTimeout(timer); reject(e); });
      socket.connect(this.port, this.host, () => { clearTimeout(timer); resolve(); });
    });
    socket.setNoDelay(true);
    socket.on("data", (d) => this.data(d));
    socket.on("error", () => {});
    socket.on("close", () => this.shut(new CompanionError("The Apple TV closed the connection")));
    await this.verify();
  }

  /** HAP pair-verify over PV_Start/PV_Next, then the session keys. */
  private async verify(): Promise<void> {
    const c = this.creds;
    const { publicKey, privateKey } = generateKeyPairSync("x25519");
    const ours = Buffer.from(publicKey.export({ type: "spki", format: "der" }).subarray(-32));
    const m2 = tlvDecode(await this.authExchange(Frame.PV_Start, tlvEncode({ [TlvTag.SeqNo]: Buffer.from([1]), [TlvTag.PublicKey]: ours }), { _auTy: 4 }));
    const theirs = m2[TlvTag.PublicKey], sealed = m2[TlvTag.EncryptedData];
    if (!theirs || !sealed) throw new CompanionError(pairError(m2[TlvTag.Error]?.[0]) ?? "The Apple TV refused the saved pairing");
    const shared = Buffer.from(diffieHellman({ privateKey, publicKey: x25519Public(theirs) }));
    const key = await hkdfSha512(shared, "Pair-Verify-Encrypt-Salt", "Pair-Verify-Encrypt-Info", 32);
    const inner = tlvDecode(decryptChaCha20(key, pvNonce("PV-Msg02"), sealed.subarray(0, -TAG), sealed.subarray(-TAG), Buffer.alloc(0)));
    const id = inner[TlvTag.Identifier], sig = inner[TlvTag.Signature];
    if (!id || !sig || !verify(null, Buffer.concat([theirs, id, ours]), ed25519Public(hex(c.serverLTPK)), sig)) throw new CompanionError("The Apple TV's identity did not match the pairing; pair again");
    const mine = sign(null, Buffer.concat([ours, Buffer.from(c.clientId), theirs]), ed25519Private(hex(c.clientLTSK)));
    const { ciphertext, tag } = encryptChaCha20(key, pvNonce("PV-Msg03"), tlvEncode({ [TlvTag.Identifier]: Buffer.from(c.clientId), [TlvTag.Signature]: mine }), Buffer.alloc(0));
    const m4 = tlvDecode(await this.authExchange(Frame.PV_Next, tlvEncode({ [TlvTag.SeqNo]: Buffer.from([3]), [TlvTag.EncryptedData]: Buffer.concat([ciphertext, tag]) })));
    const err = m4[TlvTag.Error]?.[0];
    if (err) throw new CompanionError(pairError(err) ?? "The Apple TV refused the saved pairing; pair again");
    this.out = new Cipher(await hkdfSha512(shared, "", "ClientEncrypt-main", 32));
    this.in = new Cipher(await hkdfSha512(shared, "", "ServerEncrypt-main", 32));
  }

  private authExchange(type: number, pd: Buffer, extra: Dict = {}): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.auth = undefined; reject(new CompanionError(`${this.host} did not answer the pairing check`)); }, TIMEOUT_MS);
      this.auth = {
        resolve: (d) => { clearTimeout(timer); const b = d._pd; b instanceof Uint8Array ? resolve(Buffer.from(b)) : reject(new CompanionError("The Apple TV sent no pairing data")); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      this.write(pack({ _pd: pd, ...extra }), type);
    });
  }

  /** A frame: sealed once pair-verify gave the keys, plain before. */
  private write(payload: Buffer, type: number): void {
    if (!this.socket || this.closed) throw new CompanionError("Not connected to the Apple TV");
    this.socket.write(this.out ? this.out.seal(type, payload) : Buffer.concat([frameHeader(type, payload.length), payload]));
  }

  private data(d: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 4) {
      const len = this.buf.readUIntBE(1, 3);
      if (this.buf.length < 4 + len) break;
      const header = this.buf.subarray(0, 4), body = this.buf.subarray(4, 4 + len), type = header[0];
      this.buf = this.buf.subarray(4 + len);
      try {
        const plain = this.in && len > 0 ? this.in.open(header, body) : body;
        const msg = unpack(plain).value;
        if (!msg || typeof msg !== "object" || msg instanceof Map) continue;
        if (type === Frame.PV_Next || type === Frame.PV_Start) { const a = this.auth; this.auth = undefined; a?.resolve(msg as Dict); continue; }
        this.dispatch(msg as Dict);
      } catch (e) {
        // A frame that does not decrypt means the stream is out of step: nothing after it can be read.
        this.shut(new CompanionError(`Could not read the Apple TV's reply (${e instanceof Error ? e.message : String(e)})`));
        return;
      }
    }
  }

  private dispatch(msg: Dict): void {
    if (msg._t === 1) { for (const l of this.listeners) l(String(msg._i), (msg._c ?? {}) as Dict); return; }
    if (msg._t !== 3) return;
    const p = this.pending.get(Number(msg._x));
    if (!p) return;
    this.pending.delete(Number(msg._x));
    clearTimeout(p.timer);
    if (msg._em !== undefined) p.reject(new CompanionError(String(msg._em)));
    else p.resolve((msg._c ?? {}) as Dict);
  }

  /** A request; resolves with the reply's `_c`, rejects on `_em` or after `timeoutMs`. */
  request(id: string, content: Dict = {}, timeoutMs = TIMEOUT_MS): Promise<Dict> {
    const x = this.xid++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(x); reject(new CompanionError(`The Apple TV did not answer ${id}`)); }, timeoutMs);
      this.pending.set(x, { resolve, reject, timer });
      try { this.write(pack({ _i: id, _t: 2, _c: content, _x: x }), Frame.E_OPACK); } catch (e) { clearTimeout(timer); this.pending.delete(x); reject(e); }
    });
  }

  /** A one-way event (`_interest`, `_hidT`, `_tiC`). */
  event(id: string, content: Dict): void {
    this.write(pack({ _i: id, _t: 1, _c: content, _x: this.xid++ }), Frame.E_OPACK);
  }

  onEvent(fn: (id: string, content: Dict) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onClose(fn: (error?: Error) => void): () => void { this.closers.add(fn); return () => this.closers.delete(fn); }

  private shut(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.socket?.destroy();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error ?? new CompanionError("Disconnected")); }
    this.pending.clear();
    this.auth?.reject(error ?? new CompanionError("Disconnected"));
    for (const c of this.closers) c(error);
  }

  close(): void { this.shut(); }
}

/** HAP's TLV error codes in plain words. */
export function pairError(code: number | undefined): string | undefined {
  switch (code) {
    case undefined: case 0: return undefined;
    case 2: return "Pairing was refused: the PIN was wrong";
    case 3: return "The Apple TV wants a break before the next try; wait a minute";
    case 4: return "The Apple TV has too many paired remotes";
    case 5: return "Too many wrong PINs; wait a few minutes and try again";
    case 6: return "The Apple TV is not accepting pairings right now";
    case 7: return "The Apple TV is busy pairing with something else";
    default: return `The Apple TV refused (error ${code})`;
  }
}
