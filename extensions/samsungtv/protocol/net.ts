// The two UDP things: SSDP to find TVs (an M-SEARCH to 239.255.255.250:1900
// for Samsung's remote receiver and the DLNA renderer; each answer's
// address is then asked `/api/v2/`), and Wake-on-LAN to turn one on from
// off (the magic packet to the broadcast address and the TV's own, port 9;
// it takes the TV's "Power on with mobile" / network standby setting).
import { createSocket } from "node:dgram";

export const TARGETS = ["urn:samsung.com:device:RemoteControlReceiver:1", "urn:schemas-upnp-org:device:MediaRenderer:1"];

export const msearch = (st: string, mx = 2) => `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: ${mx}\r\nST: ${st}\r\n\r\n`;

/** One SSDP answer's headers, lower-cased; undefined for anything that is not an HTTP 200 answer. */
export function parseResponse(msg: string): Record<string, string> | undefined {
  const [first, ...lines] = msg.split(/\r?\n/);
  if (!/^HTTP\/1\.\d 200/i.test(first ?? "")) return undefined;
  const h: Record<string, string> = {};
  for (const l of lines) { const i = l.indexOf(":"); if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }
  return h;
}

/** Whether an answer is a Samsung TV's: its SERVER (`… Samsung …`) or the remote receiver's ST. */
export const isSamsung = (h: Record<string, string>) => /samsung/i.test(h.server ?? "") || /samsung\.com:device:RemoteControlReceiver/i.test(h.st ?? "");

/** The addresses of the Samsung TVs answering within `timeoutMs`. */
export function ssdp(timeoutMs: number): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>();
    const s = createSocket({ type: "udp4", reuseAddr: true });
    const done = () => { try { s.close(); } catch {} resolve([...found]); };
    s.on("message", (buf, rinfo) => { const h = parseResponse(buf.toString()); if (h && isSamsung(h)) found.add(rinfo.address); });
    s.on("error", done);
    s.bind(0, () => { for (const st of TARGETS) s.send(msearch(st), 1900, "239.255.255.250"); });
    setTimeout(done, timeoutMs);
  });
}

/** Six 0xff, then the MAC sixteen times. */
export function magicPacket(mac: string): Buffer {
  const hex = mac.replace(/[^0-9a-f]/gi, "");
  if (hex.length !== 12) throw new Error(`${mac} is not a MAC address`);
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(Buffer.from(hex, "hex"))]);
}

/** The packet to the broadcast address and to the TV's own (a router that drops broadcast still routes that), port 9. */
export function wol(mac: string, address?: string, port = 9): Promise<void> {
  const pkt = magicPacket(mac);
  return new Promise((resolve, reject) => {
    const s = createSocket("udp4");
    s.on("error", (e) => { try { s.close(); } catch {} reject(e); });
    s.bind(0, () => {
      s.setBroadcast(true);
      const to = ["255.255.255.255", ...(address ? [address] : [])];
      let left = to.length;
      for (const a of to) s.send(pkt, port, a, () => { if (--left === 0) { s.close(); resolve(); } });
    });
  });
}
