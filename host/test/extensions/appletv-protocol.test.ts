// The Apple TV extension's protocol layer, off the network: OPACK against
// pyatv's test vectors (back-references included), the Companion frame
// cipher's header and nonce, the RTI text payloads, the MRP schema and the
// now-playing state built from recorded messages, the model names and the
// pairing errors in words.
import { describe, expect, test } from "bun:test";
import { Cipher, frameHeader, nonce, pairError } from "../../../extensions/appletv/protocol/companion.ts";
import { Players, T, commandFields, decode as mrpDecode, encode as mrpEncode, CF_EPOCH } from "../../../extensions/appletv/protocol/mrp.ts";
import { Uuid, decode, float, pack, sized, unpack } from "../../../extensions/appletv/protocol/opack.ts";
import { archive, clearPayload, insertPayload, readArchive, readSession } from "../../../extensions/appletv/protocol/rti.ts";
import { MODELS, modelName, pairFailure } from "../../../extensions/appletv/device.ts";

const h = (s: string) => Buffer.from(s.replace(/\s/g, ""), "hex");
const bytes = (...b: number[]) => Buffer.from(b);
const a = (s: string) => Buffer.from(s, "latin1");

describe("opack pack", () => {
  test("scalars", () => {
    expect(pack(true)).toEqual(bytes(1));
    expect(pack(false)).toEqual(bytes(2));
    expect(pack(null)).toEqual(bytes(4));
    expect(pack(Uuid.parse("12345678-1234-5678-1234-567812345678"))).toEqual(h("05 12345678123456781234567812345678"));
    expect(pack(0)).toEqual(bytes(0x08));
    expect(pack(0x27)).toEqual(bytes(0x2f));
    expect(pack(0x28)).toEqual(bytes(0x30, 0x28));
    expect(pack(0x1ff)).toEqual(bytes(0x31, 0xff, 0x01));
    expect(pack(0x1ffffff)).toEqual(bytes(0x32, 0xff, 0xff, 0xff, 0x01));
    expect(pack(0x1ffffffffffffffn)).toEqual(h("33 ffffffffffffff01"));
    expect(pack(sized(1, 2))).toEqual(bytes(0x31, 1, 0));
    expect(pack(sized(1, 8))).toEqual(h("33 0100000000000000"));
    expect(pack(float(1))).toEqual(h("36 000000000000f03f"));
    expect(pack(-2.5).subarray(0, 1)).toEqual(bytes(0x36));
  });
  test("strings and bytes, short and long", () => {
    expect(pack("abc")).toEqual(a("\x43abc"));
    expect(pack("a".repeat(0x20))).toEqual(Buffer.concat([bytes(0x60), a("a".repeat(0x20))]));
    expect(pack("a".repeat(33))).toEqual(Buffer.concat([bytes(0x61, 0x21), a("a".repeat(33))]));
    expect(pack("a".repeat(256))).toEqual(Buffer.concat([bytes(0x62, 0x00, 0x01), a("a".repeat(256))]));
    expect(pack(bytes(0xac))).toEqual(bytes(0x71, 0xac));
    expect(pack(Buffer.alloc(33, 0x61))).toEqual(Buffer.concat([bytes(0x91, 0x21), Buffer.alloc(33, 0x61)]));
    expect(pack(Buffer.alloc(65536, 0x61)).subarray(0, 5)).toEqual(bytes(0x93, 0, 0, 1, 0));
  });
  test("arrays and dicts, endless past fourteen", () => {
    expect(pack([])).toEqual(bytes(0xd0));
    expect(pack([1, "test", false])).toEqual(h("d3 09 44 74657374 02"));
    expect(pack(Array(15).fill("a"))).toEqual(Buffer.concat([bytes(0xdf, 0x41, 0x61), Buffer.alloc(14, 0xa0), bytes(0x03)]));
    expect(pack({})).toEqual(bytes(0xe0));
    expect(pack(new Map<unknown, unknown>([["a", 12], [false, null]]))).toEqual(h("e2 4161 14 02 04"));
  });
  test("a repeated value is a reference to its first occurrence", () => {
    expect(pack(["a", "a"])).toEqual(h("d2 4161 a0"));
    expect(pack(["foo", "bar", "foo", "bar"])).toEqual(h("d4 43666f6f 43626172 a0 a1"));
    expect(pack({ a: "b", c: { d: "a" }, d: true })).toEqual(h("e3 4161 4162 4163 e1 4164 a0 a3 01"));
  });
  test("past 0x20 references take one, then two bytes", () => {
    const data = Array.from({ length: 257 }, (_, x) => Buffer.from(String.fromCharCode(x), "utf8"));
    const packed = pack([...data, ...data]);
    expect(packed.subarray(0, 3)).toEqual(bytes(0xdf, 0x71, 0x00));
    expect(packed.subarray(-8)).toEqual(bytes(0xc1, 0xfe, 0xc1, 0xff, 0xc2, 0x00, 0x01, 0x03));
    expect(decode(packed)).toEqual([...data, ...data]);
  });
});

describe("opack unpack", () => {
  test("scalars", () => {
    expect(unpack(bytes(1)).value).toBe(true);
    expect(unpack(bytes(4)).value).toBe(null);
    expect((unpack(h("05 12345678123456781234567812345678")).value as Uuid).toString()).toBe("12345678-1234-5678-1234-567812345678");
    expect(unpack(h("06 0100000000000000")).value).toBe(1);
    expect(unpack(bytes(0x2f)).value).toBe(0x27);
    expect(unpack(h("33 ffffffffffffff01")).value).toBe(0x1ffffffffffffffn); // past 2^53: a bigint
    expect(unpack(h("32 ffffff01")).value).toBe(0x1ffffff);
    expect(unpack(h("35 0000803f")).value).toBe(1);
    expect(unpack(h("36 000000000000f03f")).value).toBe(1);
    expect(unpack(Buffer.concat([bytes(0x62, 0, 1), a("a".repeat(256))])).value).toBe("a".repeat(256));
    expect(unpack(Buffer.concat([bytes(0x93, 0, 0, 1, 0), Buffer.alloc(65536, 0x61)])).value).toEqual(Buffer.alloc(65536, 0x61));
  });
  test("what follows the value is the rest", () => {
    const { value, rest } = unpack(bytes(0x09, 0x0a));
    expect(value).toBe(1);
    expect(rest).toEqual(bytes(0x0a));
  });
  test("endless arrays, nested, sharing references", () => {
    const l1 = Buffer.concat([bytes(0xdf, 0x41, 0x61), Buffer.alloc(15, 0xa0), bytes(0x03)]);
    const l2 = Buffer.concat([bytes(0xdf, 0x41, 0x62), Buffer.alloc(15, 0xa1), bytes(0x03)]);
    expect(decode(Buffer.concat([bytes(0xd2), l1, l2]))).toEqual([Array(16).fill("a"), Array(16).fill("b")]);
  });
  test("dicts: string keys as an object, others as a Map", () => {
    expect(decode(h("e1 01 e1 4161 0a"))).toEqual(new Map([[true, { a: 2 }]]));
    expect(decode(h("e3 4161 4162 4163 e1 4164 a0 a3 01"))).toEqual({ a: "b", c: { d: "a" }, d: true });
  });
  test("uid references of every width (0xb8 is the one the library could not read)", () => {
    for (const b of ["df 3001 3002 c101 03", "df 3001 3002 c20100 03", "df 3001 3002 c3010000 03", "df 3001 3002 c401000000 03"]) expect(decode(h(b))).toEqual([1, 2, 2]);
    const many = Array.from({ length: 25 }, (_, i) => `k${i}`);
    expect(decode(pack([...many, "k24"]))).toEqual([...many, "k24"]);
    expect(pack([...many, "k24"]).at(-2)).toBe(0xb8);
  });
  test("an unknown tag or a reference to nothing throws", () => {
    expect(() => decode(bytes(0x00))).toThrow(/unknown tag/);
    expect(() => decode(bytes(0xd1, 0xa0))).toThrow(/reference/);
  });
  test("pyatv's golden _systemInfo round-trips", () => {
    const data = {
      _i: "_systemInfo", _x: 1254122577, _btHP: false,
      _c: {
        _pubID: "AA:BB:CC:DD:EE:FF", _sv: "230.1", _bf: 0,
        _siriInfo: { collectorElectionVersion: float(1), deviceCapabilities: { seymourEnabled: 1, voiceTriggerEnabled: 2 }, sharedDataProtoBuf: Buffer.alloc(512, 8) },
        _stA: ["com.apple.LiveAudio", "com.apple.siri.wakeup", "com.apple.Seymour", "com.apple.announce", "com.apple.coreduet.sync", "com.apple.SeymourSession"],
        _i: "6c62fca18b11", _clFl: 128, _idsID: "44E14ABC-DDDD-4188-B661-11BAAAF6ECDE", _hkUID: [Uuid.parse("17ed160a-81f8-4488-962c-6b1a83eb0081")], _dC: "1", _sf: 256, model: "iPhone10,6", name: "iPhone",
      },
      _t: 2,
    };
    const back = decode(pack(data)) as Record<string, any>;
    expect(back._c._siriInfo.collectorElectionVersion).toBe(1);
    expect((back._c._hkUID[0] as Uuid).toString()).toBe("17ed160a-81f8-4488-962c-6b1a83eb0081");
    expect({ ...back, _c: { ...back._c, _siriInfo: undefined, _hkUID: undefined } }).toEqual({ ...data, _c: { ...data._c, _siriInfo: undefined, _hkUID: undefined } });
  });
});

describe("companion frames", () => {
  test("the nonce is the counter little-endian from byte 0, twelve bytes", () => {
    expect(nonce(1n)).toEqual(h("01 00000000000000 00000000"));
    expect(nonce(0x0102n)).toEqual(h("0201 000000000000 00000000"));
  });
  test("a sealed frame's header counts the tag, is the AAD, and opens in order", () => {
    const key = Buffer.alloc(32, 7);
    const out = new Cipher(key), inn = new Cipher(key);
    const plain = pack({ _i: "_hidC", _t: 2, _c: { _hBtS: 1, _hidC: 1 }, _x: 7 });
    for (let i = 0; i < 3; i++) {
      const f = out.seal(8, plain);
      expect(f.subarray(0, 4)).toEqual(frameHeader(8, plain.length + 16));
      expect(f.length).toBe(4 + plain.length + 16);
      expect(decode(inn.open(f.subarray(0, 4), f.subarray(4)))).toEqual({ _i: "_hidC", _t: 2, _c: { _hBtS: 1, _hidC: 1 }, _x: 7 });
    }
  });
  test("a frame opened out of order does not authenticate", () => {
    const out = new Cipher(Buffer.alloc(32, 1)), inn = new Cipher(Buffer.alloc(32, 1));
    out.seal(8, Buffer.from("first"));
    const second = out.seal(8, Buffer.from("second"));
    expect(() => inn.open(second.subarray(0, 4), second.subarray(4))).toThrow();
  });
  test("HAP errors read as plain words", () => {
    expect(pairError(2)).toMatch(/PIN was wrong/);
    expect(pairError(0)).toBeUndefined();
    expect(pairFailure(new Error("Companion PS M4 missing Proof (error=2)")).message).toMatch(/PIN was wrong/);
    expect(pairFailure(new Error("Companion PS timeout waiting for response frame")).message).toMatch(/did not answer/);
    expect(pairFailure(new Error("connect ECONNREFUSED 192.168.1.9:49153")).message).toMatch(/Could not reach/);
  });
});

describe("rti text payloads", () => {
  const uuid = new Uint8Array(16).fill(0xab);
  test("insert carries the text and the session, clear an empty assert", () => {
    expect(readArchive(insertPayload(uuid, "breaking bad"), ["textOperations", "keyboardOutput", "insertionText"])).toBe("breaking bad");
    expect(readArchive(insertPayload(uuid, "x"), ["textOperations", "targetSessionUUID", "NS.uuidbytes"])).toEqual(Buffer.from(uuid));
    expect(readArchive(clearPayload(uuid), ["textOperations", "textToAssert"])).toBe("");
    expect(readArchive(clearPayload(uuid), ["textOperations", "nothing", "here"])).toBeUndefined();
  });
  test("a _tiStart archive gives the session and the text before the caret", () => {
    const tiD = archive({ sessionUUID: { UID: 1 }, documentState: { UID: 2 } }, ["$null", Buffer.from(uuid), { docSt: { UID: 3 } }, { contextBeforeInput: { UID: 4 } }, "the off"]);
    expect(readSession(tiD)).toEqual({ uuid: Buffer.from(uuid), text: "the off" });
  });
});

describe("mrp", () => {
  const client = { bundleIdentifier: "com.google.ios.youtube", displayName: "YouTube" };
  const setState = (title: string, extra: Record<string, unknown> = {}, bundle = client) => ({
    type: T.SetState,
    ".setStateMessage": {
      playerPath: { client: bundle, player: { identifier: "MediaRemote-DefaultPlayer" } },
      playbackQueue: { location: 0, contentItems: [{ identifier: `id-${title}`, metadata: { title, albumName: "The Eminem Show", trackArtistName: "Eminem", duration: 290.341003, elapsedTime: 1.756477, playbackRate: 1, elapsedTimeTimestamp: 812712592.80125, mediaType: 1 } }] },
      ...extra,
    },
  });

  test("a recorded SetState is what plays, in the contract's shape", () => {
    const p = new Players();
    expect(p.nowPlaying()).toBeUndefined();
    p.handle(setState("Without Me", { playbackState: 1, supportedCommands: { supportedCommands: [{ command: 3, enabled: true }, { command: 45, enabled: true }, { command: 47, enabled: true, shuffleMode: 1 }, { command: 46, enabled: true, repeatMode: 3 }, { command: 22, enabled: false }] } }));
    expect(p.nowPlaying()).toEqual({
      state: "playing", title: "Without Me", artist: "Eminem", album: "The Eminem Show", series: undefined, season: undefined, episode: undefined,
      mediaType: "music", genre: undefined, duration: 290.341003, position: 1.756477, at: Math.round((812712592.80125 + CF_EPOCH) * 1000), rate: 1,
      app: { id: "com.google.ios.youtube", name: "YouTube" }, shuffle: "off", repeat: "all", itemId: "id-Without Me", artworkAvailable: undefined,
      commands: ["toggle", "seek", "shuffle", "repeat"],
    });
  });
  test("pyatv's states: paused, paused without an item is idle, a rate other than 1 seeks", () => {
    const p = new Players();
    p.handle(setState("A", { playbackState: 2 }));
    expect(p.nowPlaying()!.state).toBe("paused");
    const q = new Players();
    q.handle({ type: T.SetState, ".setStateMessage": { playerPath: { client }, playbackState: 2 } });
    expect(q.nowPlaying()!.state).toBe("idle");
    const r = new Players();
    r.handle(setState("A", { playbackState: 1 }));
    r.handle({ type: T.UpdateContentItem, ".updateContentItemMessage": { playerPath: { client }, contentItems: [{ identifier: "id-A", metadata: { playbackRate: 2 } }] } });
    expect(r.nowPlaying()).toMatchObject({ state: "seeking", rate: 2, title: "A" });
  });
  test("the client in front is the one SetNowPlayingClient names, else the one heard from last", () => {
    const p = new Players();
    const music = { bundleIdentifier: "com.apple.TVMusic", displayName: "Music" };
    p.handle(setState("Song", { playbackState: 2 }, music));
    p.handle(setState("Video", { playbackState: 1 }));
    expect(p.nowPlaying()!.title).toBe("Video");
    p.handle({ type: T.SetNowPlayingClient, ".setNowPlayingClientMessage": { client: music } });
    expect(p.nowPlaying()).toMatchObject({ title: "Song", app: { id: "com.apple.TVMusic", name: "Music" } });
    p.handle({ type: T.RemoveClient, ".removeClientMessage": { client: music } });
    expect(p.nowPlaying()!.title).toBe("Video");
  });
  test("SendCommand with its option survives the schema both ways", async () => {
    const seek = await mrpDecode(await mrpEncode(T.SendCommand, "sendCommandMessage", "SendCommandMessage", commandFields("seek", 93.5)));
    expect(seek.type).toBe(T.SendCommand);
    expect(seek[".sendCommandMessage"]).toEqual({ command: 45, options: { playbackPosition: 93.5 } });
    expect(commandFields("skip_backward")).toEqual({ command: 19, options: { skipInterval: 10 } });
    expect(commandFields("toggle")).toEqual({ command: 3 });
    // The messages the library's schema lacks (pyatv's numbering) decode too.
    const player = await mrpDecode(await mrpEncode(T.SetNowPlayingPlayer, "setNowPlayingPlayerMessage", "SetNowPlayingPlayerMessage", { playerPath: { client, player: { identifier: "p1" } } }));
    expect(player).toMatchObject({ type: 47, ".setNowPlayingPlayerMessage": { playerPath: { player: { identifier: "p1" } } } });
  });
});

describe("models", () => {
  test("identifiers as people say them", () => {
    expect(modelName("AppleTV11,1")).toBe("Apple TV 4K (2nd generation)");
    expect(modelName("AppleTV14,1")).toBe("Apple TV 4K (3rd generation)");
    expect(modelName("AppleTV5,3")).toBe("Apple TV HD");
    expect(modelName("AppleTV99,9")).toBe("Apple TV");
    expect(Object.keys(MODELS).every((k) => k.startsWith("AppleTV"))).toBe(true);
  });
});
