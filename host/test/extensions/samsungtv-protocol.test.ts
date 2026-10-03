// The Samsung TV extension's protocol layer: the pure pieces (the REST
// description as a 2024 QE75QN85D answers it, SOAP in and out, SSDP lines,
// the magic packet, the remote's messages) and the real driver against a
// stand-in TV on one local port: REST, UPnP and the remote websocket
// (plain ws, the same messages the TV's wss carries).
import { afterEach, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { makeDriver } from "../../../extensions/samsungtv/device.ts";
import { isSamsung, magicPacket, msearch, parseResponse } from "../../../extensions/samsungtv/protocol/net.ts";
import { appsMsg, imeText, keyMsg, launchMsg, parseApps, refusal, remoteUrl, textEndMsg, textMsg } from "../../../extensions/samsungtv/protocol/remote.ts";
import { decodeEntities, parseInfo } from "../../../extensions/samsungtv/protocol/rest.ts";
import { envelope, fault, fields, hms, mediaOf, RC } from "../../../extensions/samsungtv/protocol/upnp.ts";
import type { ChangeEvent, Conn, Paired } from "../../../extensions/samsungtv/types.ts";

/** `/api/v2/` from the living-room TV, 2026-10-04 (trimmed). */
const INFO = {
  device: { FrameTVSupport: "false", OS: "Tizen", PowerState: "on", TokenAuthSupport: "true", duid: "uuid:32ed4ce1-0d5b-41e6-a3c1-dc1a43af0e94", ip: "192.168.1.31", modelName: "QE75QN85DBTXTK", name: "75&quot; Neo QLED", wifiMac: "F4:DD:06:41:3A:4C" },
  id: "uuid:32ed4ce1-0d5b-41e6-a3c1-dc1a43af0e94", name: "75&quot; Neo QLED", type: "Samsung SmartTV",
};

describe("rest", () => {
  test("names decode their entities", () => {
    expect(decodeEntities("75&quot; Neo QLED")).toBe('75" Neo QLED');
    expect(decodeEntities("A &amp; B &#39;x&#x27; &bogus;")).toBe("A & B 'x' &bogus;");
  });
  test("the description as Found", () => {
    expect(parseInfo("192.168.1.31", INFO)).toEqual({ id: "uuid:32ed4ce1-0d5b-41e6-a3c1-dc1a43af0e94", address: "192.168.1.31", power: "on", name: '75" Neo QLED', model: "QE75QN85DBTXTK", mac: "F4:DD:06:41:3A:4C", tokenAuth: true, frame: undefined });
    expect(parseInfo("x", { device: { ...INFO.device, PowerState: "standby", wifiMac: "none" } })).toMatchObject({ power: "standby", mac: undefined });
    expect(parseInfo("x", { nope: 1 })).toBeUndefined();
  });
});

describe("upnp", () => {
  test("an envelope carries InstanceID first and escapes its values", () => {
    const xml = envelope(RC, "SetVolume", { Channel: "Master", DesiredVolume: 12 });
    expect(xml).toContain(`<u:SetVolume xmlns:u="${RC}"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>12</DesiredVolume></u:SetVolume>`);
    expect(envelope(RC, "X", { A: "<&>" })).toContain("<A>&lt;&amp;&gt;</A>");
  });
  test("fields of a response, and a fault", () => {
    // The TV's own GetVolume answer, a newline before the closing tag included.
    const xml = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:GetVolumeResponse xmlns:u="${RC}"><CurrentVolume>10</CurrentVolume>\n</u:GetVolumeResponse></s:Body></s:Envelope>`;
    expect(fields(xml)).toEqual({ CurrentVolume: "10" });
    expect(fault("<s:Fault><detail><UPnPError><errorCode>501</errorCode><errorDescription>Action Failed</errorDescription></UPnPError></detail></s:Fault>")).toBe("Action Failed");
  });
  test("what a DLNA sender plays, and nothing when nothing does", () => {
    expect(hms("0:00:00")).toBe(0);
    expect(hms("01:02:03.500")).toBe(3723);
    expect(hms("NOT_IMPLEMENTED")).toBeUndefined();
    // The living-room TV with nothing cast: NO_MEDIA_PRESENT.
    expect(mediaOf({ CurrentTransportState: "NO_MEDIA_PRESENT" }, { TrackURI: "", RelTime: "0:00:00", TrackDuration: "0:00:00" }, 1)).toBeUndefined();
    const meta = "&lt;DIDL-Lite&gt;&lt;item&gt;&lt;dc:title&gt;Harbour &amp;amp; Lights&lt;/dc:title&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;";
    const p = fields(`<u:GetPositionInfoResponse><TrackURI>http://x/a.mp4</TrackURI><TrackMetaData>${meta}</TrackMetaData><RelTime>0:01:05</RelTime><TrackDuration>0:42:00</TrackDuration></u:GetPositionInfoResponse>`);
    expect(mediaOf({ CurrentTransportState: "PAUSED_PLAYBACK" }, p, 7)).toEqual({ state: "paused", at: 7, url: "http://x/a.mp4", title: "Harbour & Lights", position: 65, duration: 2520 });
  });
});

describe("net", () => {
  test("an M-SEARCH, and which answers are a Samsung TV's", () => {
    expect(msearch("ssdp:all")).toBe('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n');
    const h = parseResponse("HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.31:9197/dmr\r\nSERVER: SHP, UPnP/1.0, Samsung UPnP SDK/1.0\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n")!;
    expect(h.location).toBe("http://192.168.1.31:9197/dmr");
    expect(isSamsung(h)).toBe(true);
    // The Hue bridge on the same network.
    expect(isSamsung(parseResponse("HTTP/1.1 200 OK\r\nSERVER: Hue/1.0 UPnP/1.0 IpBridge/1.78.0\r\nST: upnp:rootdevice\r\n\r\n")!)).toBe(false);
    expect(parseResponse("NOTIFY * HTTP/1.1\r\n")).toBeUndefined();
  });
  test("the magic packet", () => {
    const p = magicPacket("F4:DD:06:41:3A:4C");
    expect(p.length).toBe(102);
    expect(p.subarray(0, 6)).toEqual(Buffer.alloc(6, 0xff));
    expect(p.subarray(96).toString("hex")).toBe("f4dd06413a4c");
    expect(() => magicPacket("nope")).toThrow("is not a MAC address");
  });
});

describe("remote messages", () => {
  test("the url names pal in base64 and carries the token", () => {
    expect(remoteUrl("192.168.1.31")).toBe("wss://192.168.1.31:8002/api/v2/channels/samsung.remote.control?name=cGFs");
    expect(remoteUrl("h", "123", { port: 9, secure: false })).toBe("ws://h:9/api/v2/channels/samsung.remote.control?name=cGFs&token=123");
  });
  test("keys, text, launches", () => {
    expect(keyMsg("KEY_UP")).toEqual({ method: "ms.remote.control", params: { Cmd: "Click", DataOfCmd: "KEY_UP", Option: "false", TypeOfRemote: "SendRemoteKey" } });
    expect(keyMsg("KEY_POWER", "Press").params.Cmd).toBe("Press");
    expect(textMsg("şey 1")).toEqual({ method: "ms.remote.control", params: { Cmd: Buffer.from("şey 1").toString("base64"), DataOfCmd: "base64", TypeOfRemote: "SendInputString" } });
    expect(textEndMsg()).toEqual({ method: "ms.remote.control", params: { TypeOfRemote: "SendInputEnd" } });
    expect(appsMsg()).toEqual({ method: "ms.channel.emit", params: { event: "ed.installedApp.get", to: "host" } });
    expect(launchMsg("111299001912", 2, "v=abc").params.data).toEqual({ action_type: "DEEP_LINK", appId: "111299001912", metaTag: "v=abc" });
    expect(launchMsg("org.tizen.browser").params.data).toEqual({ action_type: "NATIVE_LAUNCH", appId: "org.tizen.browser" });
  });
  test("apps, keyboard text, refusals", () => {
    expect(parseApps({ data: [{ appId: "111299001912", app_type: 2, icon: "/opt/yt.png", name: "YouTube" }, { name: "no id" }] })).toEqual([{ id: "111299001912", name: "YouTube", type: 2, icon: "/opt/yt.png" }]);
    expect(parseApps(undefined)).toEqual([]);
    expect(imeText(Buffer.from("merhaba").toString("base64"))).toBe("merhaba");
    expect(imeText("plain text")).toBe("plain text");
    expect(refusal("ms.channel.unauthorized")).toContain("Deny was pressed");
    expect(refusal("ms.channel.timeOut")).toBe("No one pressed Allow on the TV in time");
  });
});

// ---- the driver against a stand-in TV ---------------------------------------------------------------

type Tv = {
  power: "on" | "standby";
  volume: number;
  muted: boolean;
  /** Installed apps by id, with whether each is in front. */
  apps: Record<string, { name: string; visible: boolean }>;
  /** What the remote's connect answers: a token, or a refusal event. */
  answer: { token: string } | { refuse: string };
  installed: unknown[];
  got: any[];
  soap: string[];
  sockets: Set<ServerWebSocket<unknown>>;
  urls: string[];
  onKey?: (code: string) => void;
};

let server: Server<unknown> | undefined;
let conn: Conn | undefined;
afterEach(async () => { await conn?.close(); conn = undefined; server?.stop(true); server = undefined; });

function standIn(): { tv: Tv; port: number } {
  const tv: Tv = { power: "on", volume: 10, muted: false, apps: { "111299001912": { name: "YouTube", visible: false } }, answer: { token: "t-1" }, installed: [], got: [], soap: [], sockets: new Set(), urls: [] };
  server = Bun.serve({
    port: 0,
    async fetch(req, srv) {
      const u = new URL(req.url);
      if (u.pathname.startsWith("/api/v2/channels/")) { tv.urls.push(u.search); return srv.upgrade(req, { data: undefined }) ? undefined : new Response("no", { status: 400 }); }
      if (u.pathname === "/api/v2/") return Response.json({ ...INFO, device: { ...INFO.device, PowerState: tv.power } });
      const app = /^\/api\/v2\/applications\/(.+)$/.exec(u.pathname)?.[1];
      if (app) {
        const a = tv.apps[decodeURIComponent(app)];
        if (!a) return Response.json({ code: 404 }, { status: 404 });
        if (req.method !== "GET") { tv.got.push({ rest: req.method, app }); return new Response("true"); }
        return Response.json({ id: app, name: a.name, running: a.visible, visible: a.visible, version: "1" });
      }
      if (u.pathname.startsWith("/upnp/control/")) {
        const body = await req.text(), action = /SOAPACTION: "?[^#]+#(\w+)/i.exec(`SOAPACTION: ${req.headers.get("soapaction")}`)?.[1] ?? "";
        tv.soap.push(action);
        const val = (k: string) => new RegExp(`<${k}>([^<]*)</${k}>`).exec(body)?.[1];
        let out = "";
        if (action === "GetVolume") out = `<CurrentVolume>${tv.volume}</CurrentVolume>`;
        else if (action === "GetMute") out = `<CurrentMute>${tv.muted ? 1 : 0}</CurrentMute>`;
        else if (action === "SetVolume") tv.volume = Number(val("DesiredVolume"));
        else if (action === "SetMute") tv.muted = val("DesiredMute") === "1";
        else if (action === "GetTransportInfo") out = "<CurrentTransportState>NO_MEDIA_PRESENT</CurrentTransportState>";
        else if (action === "GetPositionInfo") out = "<TrackURI></TrackURI>";
        return new Response(`<s:Envelope><s:Body><u:${action}Response>${out}</u:${action}Response></s:Body></s:Envelope>`);
      }
      return new Response("?", { status: 404 });
    },
    websocket: {
      open(ws) {
        tv.sockets.add(ws);
        const a = tv.answer;
        ws.send(JSON.stringify("refuse" in a ? { event: a.refuse } : { event: "ms.channel.connect", data: { id: "x", token: a.token, clients: [] } }));
      },
      message(ws, m) {
        const j = JSON.parse(String(m));
        tv.got.push(j);
        if (j.params?.TypeOfRemote === "SendRemoteKey") tv.onKey?.(j.params.DataOfCmd);
        if (j.params?.event === "ed.installedApp.get") ws.send(JSON.stringify({ event: "ed.installedApp.get", data: { data: tv.installed } }));
        if (j.params?.event === "ed.apps.icon") ws.send(JSON.stringify({ event: "ed.apps.icon", data: { iconPath: j.params.data.iconPath, imageBase64: Buffer.from("PNG").toString("base64") } }));
      },
      close(ws) { tv.sockets.delete(ws); },
    },
  });
  return { tv, port: server.port! };
}

const paired = (token = "t-1"): Paired => ({ id: INFO.device.duid, name: '75" Neo QLED', address: "127.0.0.1", model: "QE75QN85DBTXTK", token, pairedAt: 0 });
/** Every event the connection told, collected; `until` waits for a condition on the stand-in (real I/O, polled quickly). */
const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await Bun.sleep(5); expect(f()).toBe(true); };
const sends = (tv: Tv) => tv.got.filter((g) => g.method);

describe("the driver against a stand-in TV", () => {
  test("pairing: Allow hands the token over, Deny is said in words, the url carries no token", async () => {
    const { tv, port } = standIn();
    const d = makeDriver({ port, pollMs: 60_000 });
    const found = (await d.probe("127.0.0.1"))!;
    expect(found).toMatchObject({ name: '75" Neo QLED', power: "on", tokenAuth: true });
    expect(await (await d.pair(found)).token).toBe("t-1");
    expect(tv.urls).toEqual(["?name=cGFs"]);
    tv.answer = { refuse: "ms.channel.unauthorized" };
    await expect((await d.pair(found)).token).rejects.toThrow("Deny was pressed");
  });

  test("connected: state from REST and UPnP, keys and text on the socket, a new token told", async () => {
    const { tv, port } = standIn();
    tv.answer = { token: "t-2" };
    const d = makeDriver({ port, pollMs: 60_000 });
    const events: ChangeEvent[] = [];
    const c = (conn = await d.connect(paired()));
    c.on((e) => events.push(e));
    await until(() => c.remoteUp);
    expect(tv.urls.at(-1)).toBe("?name=cGFs&token=t-1");
    expect([c.power(), c.volume(), c.muted(), c.media()]).toEqual(["on", 10, false, undefined]);
    await c.key("up");
    await c.type("ab", true);
    await c.setInput("hdmi");
    await until(() => sends(tv).length === 4);
    expect(sends(tv).map((g) => g.params.DataOfCmd ?? g.params.TypeOfRemote)).toEqual(["KEY_UP", "base64", "SendInputEnd", "KEY_HDMI"]);
    await c.setVolume(23);
    await c.setMuted(true);
    expect([tv.volume, tv.muted, c.volume(), c.muted()]).toEqual([23, true, 23, true]);
    expect(events.filter((e) => e.kind === "volume").length).toBe(2);
  });

  test("the token the TV gives on connect is the connection's, so it can be stored", async () => {
    const { tv, port } = standIn();
    tv.answer = { token: "t-new" };
    const c = (conn = await makeDriver({ port, pollMs: 60_000 }).connect(paired("t-old")));
    await until(() => c.remoteUp);
    expect(tv.urls.at(-1)).toBe("?name=cGFs&token=t-old");
    expect(c.token).toBe("t-new");
  });

  test("the keyboard opening, its text, and closing", async () => {
    const { tv, port } = standIn();
    const c = (conn = await makeDriver({ port, pollMs: 60_000 }).connect(paired()));
    await until(() => c.remoteUp && tv.sockets.size === 1);
    const ws = [...tv.sockets][0];
    ws.send(JSON.stringify({ event: "ms.remote.imeStart" }));
    await until(() => c.keyboard().open);
    ws.send(JSON.stringify({ event: "ms.remote.imeUpdate", data: Buffer.from("film").toString("base64") }));
    await until(() => c.keyboard().text === "film");
    ws.send(JSON.stringify({ event: "ms.remote.imeEnd" }));
    await until(() => !c.keyboard().open);
  });

  test("apps: the TV's list when it gives one, else the catalog over REST; launch and the icon", async () => {
    const { tv, port } = standIn();
    const c = (conn = await makeDriver({ port, pollMs: 60_000 }).connect(paired()));
    await until(() => c.remoteUp);
    // A 2024 TV may answer installedApp.get with nothing: YouTube is found by its catalog id.
    expect(await c.apps()).toEqual([{ id: "111299001912", name: "YouTube" }]);
    tv.installed = [{ appId: "3201606009684", name: "Spotify", app_type: 4, icon: "/i/sp.png" }];
    const apps = await c.apps();
    expect(apps).toEqual([{ id: "3201606009684", name: "Spotify", type: 4, icon: "/i/sp.png" }]);
    expect(Buffer.from((await c.icon(apps[0]))!).toString()).toBe("PNG");
    await c.launch("3201606009684");
    tv.apps["3201606009684"] = { name: "Spotify", visible: false };
    await c.quit("3201606009684");
    await until(() => tv.got.some((g) => g.params?.event === "ed.apps.launch") && tv.got.some((g) => g.rest === "DELETE"));
    expect(tv.got.find((g) => g.params?.event === "ed.apps.launch").params.data).toEqual({ action_type: "NATIVE_LAUNCH", appId: "3201606009684" });
  });

  test("standby: nothing read but power, no remote until asked; turning on presses Power on the socket", async () => {
    const { tv, port } = standIn();
    tv.power = "standby";
    const c = (conn = await makeDriver({ port, pollMs: 60_000 }).connect(paired()));
    expect([c.power(), c.remoteUp, c.volume()]).toEqual(["standby", false, undefined]);
    expect(tv.urls).toEqual([]);
    expect(tv.soap).toEqual([]);
    await c.turnOff();
    expect(sends(tv)).toEqual([]);
    // The stand-in wakes on KEY_POWER; no MAC is paired, so no Wake-on-LAN goes out.
    tv.onKey = (code) => { if (code === "KEY_POWER") tv.power = "on"; };
    await c.turnOn();
    expect(c.power()).toBe("on");
    expect(sends(tv).map((g) => g.params.DataOfCmd)).toEqual(["KEY_POWER"]);
  });

  test("a TV that does not answer is not connected to", async () => {
    const { port } = standIn();
    server!.stop(true);
    await expect(makeDriver({ port, pollMs: 60_000 }).connect(paired())).rejects.toThrow("does not answer");
  });
});
