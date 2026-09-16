// The bridge over CLIP v2: one `Client` per paired bridge (https with the
// Signify root CA and the bridge's own certificate pinned, the
// `hue-application-key` header, one timeout), discovery (the cloud
// endpoint and mDNS through the OS's browser), press-link pairing (the v1
// `POST /api`, the only thing v2 lacks), the event stream (`/eventstream/
// clip/v2`, server-sent events parsed by hand) and the certificate peek
// pairing pins. No pal imports, so the tests drive these against a mock.
import { connect as tlsConnect } from "node:tls";
import { ROOT_BRIDGE_PEM } from "./cert.ts";

export const SETTINGS_HINT = "Settings › Extensions › Hue";
/** Hue's guidance: at most 10 light commands and 1 group command a second. */
export const LIGHT_GAP_MS = 100, GROUP_GAP_MS = 1000;
/** The link button stays armed this long after a press. */
export const PAIR_WINDOW_MS = 30_000;

/** A request that did not work, with a one-line `hint` for the row or toast. */
export class HueError extends Error {
  constructor(message: string, readonly hint: string, readonly status?: number) { super(message); }
}

/** One paired bridge as storage keeps it (`bridges`). `cert` is the leaf certificate pairing saw, pinned beside the root CA; `key` the application key. */
export type Bridge = { id: string; ip: string; name: string; key: string; clientkey?: string; cert?: string; paired_at?: number; /** From the settings rather than storage: the key never leaves the file's reference. */ from_settings?: boolean };

/** A resource as the bridge sends it: `id`, `type`, and the rest by type. */
export type Resource = { id: string; type: string; id_v1?: string; owner?: Ref; [k: string]: unknown };
export type Ref = { rid: string; rtype: string };
/** One event of the stream: `data` holds partial resources (`update`), whole ones (`add`) or just ids (`delete`). */
export type HueEvent = { id: string; type: "update" | "add" | "delete" | "error"; creationtime: string; data: Resource[] };

export type TlsOptions = { insecure?: boolean; cert?: string };

/** `fetch`'s `tls` for a bridge: the root CA plus the pinned leaf, and no host-name check (the CN is the bridge id, not the IP). */
export const tlsFor = (o: TlsOptions) => (o.insecure ? { rejectUnauthorized: false } : { ca: [ROOT_BRIDGE_PEM, ...(o.cert ? [o.cert] : [])], checkServerIdentity: () => undefined });

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What went wrong with a `fetch` that threw: a certificate the pin refused reads differently from a host that is not there. */
function fetchFailure(ip: string, e: unknown, timeoutMs: number): HueError {
  if (isTimeout(e)) return new HueError(`${ip} did not answer in ${timeoutMs / 1000} s`, "Is the bridge on and on this network? The `bridge` setting or a new pairing fixes a moved one");
  const m = reason(e);
  if (/certificate|CERT|self.signed|unable to verify|handshake|SSL|TLS/i.test(m)) return new HueError(`${ip}: the certificate is not the paired bridge's`, `${m}. Pair again to pin the new one, or set insecure = true under ${SETTINGS_HINT}`);
  return new HueError(`Could not reach ${ip}`, `${m}. Check the address under ${SETTINGS_HINT} or run Set up Hue again`);
}

export class Client {
  constructor(readonly bridge: Bridge, readonly opts: { timeoutMs: number; insecure?: boolean }) {}
  get ip() { return this.bridge.ip; }
  private get tls() { return tlsFor({ insecure: this.opts.insecure, cert: this.bridge.cert }); }

  private async request<T>(method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`https://${this.ip}${path}`, {
        method,
        headers: { "hue-application-key": this.bridge.key, ...(body !== undefined && { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
        // Bun: the pin. Typed loosely since the option is Bun's, not the standard's.
        tls: this.tls,
      } as RequestInit);
    } catch (e) {
      throw fetchFailure(this.ip, e, this.opts.timeoutMs);
    }
    if (res.status === 401 || res.status === 403) throw new HueError("The bridge rejected the application key", `Run Set up Hue again to pair afresh, or fix the key under ${SETTINGS_HINT}`, res.status);
    if (res.status === 429) throw new HueError("The bridge is rate limiting", "Too many commands a second; wait a moment", 429);
    if (res.status === 404) throw new HueError(`The bridge has no ${path.split("/").slice(-2).join("/")}`, "It may have been removed; cmd+r lists again", 404);
    let json: { errors?: { description?: string }[]; data?: T } = {};
    try { json = (await res.json()) as typeof json; } catch { /* an empty body */ }
    if (!res.ok) throw new HueError(`The bridge answered ${res.status} for ${method} ${path}`, json.errors?.map((e) => e.description).filter(Boolean).join("; ") || res.statusText, res.status);
    if (json.errors?.length) throw new HueError(`The bridge refused ${method} ${path}`, json.errors.map((e) => e.description).filter(Boolean).join("; "), res.status);
    return json.data as T;
  }

  /** Every resource of the bridge, one request. */
  all() { return this.request<Resource[]>("GET", "/clip/v2/resource"); }
  get(type: string, id: string) { return this.request<Resource[]>("GET", `/clip/v2/resource/${type}/${id}`).then((r) => r[0]); }
  list(type: string) { return this.request<Resource[]>("GET", `/clip/v2/resource/${type}`); }
  /** `PUT` a partial resource; the bridge answers the ids it changed. */
  put(type: string, id: string, body: Record<string, unknown>) { return this.request<Ref[]>("PUT", `/clip/v2/resource/${type}/${id}`, body); }

  /**
   * The event stream, as a stream of events until `signal` aborts or the
   * bridge closes it. Server-sent events: `id: <ts>:0` then `data: [..]`
   * lines ending in a blank line; a line with neither is a comment or
   * keep-alive. `onOpen` runs once the bridge answered 200.
   */
  async *events(signal: AbortSignal, onOpen?: () => void): AsyncGenerator<HueEvent> {
    let res: Response;
    try {
      res = await fetch(`https://${this.ip}/eventstream/clip/v2`, { headers: { "hue-application-key": this.bridge.key, Accept: "text/event-stream" }, signal, tls: this.tls } as RequestInit);
    } catch (e) {
      throw fetchFailure(this.ip, e, this.opts.timeoutMs);
    }
    if (res.status === 401 || res.status === 403) throw new HueError("The bridge rejected the application key", "Run Set up Hue again", res.status);
    if (!res.ok || !res.body) throw new HueError(`The event stream answered ${res.status}`, res.statusText, res.status);
    onOpen?.();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const ev of parseSse(block)) yield ev;
      }
    }
  }
}

/** One SSE block (the lines between two blank lines) as the events its `data` carries; junk is skipped. */
export function parseSse(block: string): HueEvent[] {
  const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
  if (!data) return [];
  try {
    const parsed = JSON.parse(data) as unknown;
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((e): e is HueEvent => !!e && typeof e === "object" && Array.isArray((e as HueEvent).data));
  } catch {
    return [];
  }
}

// ---- discovery --------------------------------------------------------------

export type Found = { id: string; ip: string; name?: string; port?: number; via: "cloud" | "mdns" | "setting" };

export const DISCOVERY_URL = "https://discovery.meethue.com/";

/** The cloud endpoint: every bridge that phoned home from this public IP. Rate limited by Signify, so callers cache it. */
export async function discoverCloud(url = DISCOVERY_URL, timeoutMs = 4000): Promise<Found[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HueError(`discovery.meethue.com answered ${res.status}`, res.status === 429 ? "Rate limited; try again in a minute or type the address" : "Type the bridge's address instead");
  const list = (await res.json()) as { id?: string; internalipaddress?: string; port?: number }[];
  return list.filter((b) => b.id && b.internalipaddress).map((b) => ({ id: b.id!.toLowerCase(), ip: b.port && b.port !== 443 ? `${b.internalipaddress}:${b.port}` : b.internalipaddress!, port: b.port, via: "cloud" as const }));
}

/** `dns-sd -B` (macOS) prints one line per instance; `avahi-browse -rpt` (Linux) one `=;` line per resolved service. */
export function parseMdns(out: string): Found[] {
  const found: Found[] = [];
  for (const line of out.split("\n")) {
    const avahi = line.startsWith("=;") ? line.split(";") : undefined;
    if (avahi && avahi.length >= 10) {
      const id = /bridgeid=([0-9a-f]+)/i.exec(avahi.slice(9).join(";"))?.[1]?.toLowerCase();
      if (id && avahi[7]) found.push({ id, ip: avahi[7], name: avahi[3].replace(/\\032/g, " "), port: Number(avahi[8]) || 443, via: "mdns" });
      continue;
    }
    const m = /_hue\._tcp\.\s+(.+?)\s*$/.exec(line);
    if (m && !/Instance Name/.test(line)) found.push({ id: "", ip: "", name: m[1].replace(/\\032/g, " "), via: "mdns" });
  }
  return found;
}

/** `dns-sd -L` says `can be reached at <host>:<port>` and prints the TXT record on the next line. */
export function parseMdnsLookup(out: string): { host?: string; port?: number; id?: string } {
  const at = /can be reached at ([^\s:]+):(\d+)/.exec(out);
  const id = /bridgeid=([0-9a-f]+)/i.exec(out)?.[1]?.toLowerCase();
  return { host: at?.[1]?.replace(/\.$/, ""), port: at ? Number(at[2]) : undefined, id };
}

/** Runs a tool for at most `ms` and answers what it printed; the mDNS browsers never exit on their own, so it is also stopped `idle` ms after the last line once something has come. */
async function runFor(cmd: string[], ms: number, idle = 400): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>;
  try { proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" }); } catch { return ""; }
  const stop = () => { try { proc.kill(); } catch { /* gone */ } };
  const hard = setTimeout(stop, ms);
  let soft: ReturnType<typeof setTimeout> | undefined;
  let out = "";
  try {
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      out += new TextDecoder().decode(chunk);
      if (soft) clearTimeout(soft);
      soft = setTimeout(stop, idle);
    }
  } catch { /* killed */ }
  clearTimeout(hard);
  if (soft) clearTimeout(soft);
  return out;
}

/** The bridges on the LAN by mDNS (`_hue._tcp`): best effort, empty without a browser tool. `PAL_HUE_MDNS` names a substitute for `dns-sd` in tests. */
export async function discoverMdns(ms = 2500): Promise<Found[]> {
  const dnssd = process.env.PAL_HUE_MDNS ?? "dns-sd";
  if (process.platform === "linux" && !process.env.PAL_HUE_MDNS) {
    return parseMdns(await runFor(["avahi-browse", "-rpt", "_hue._tcp"], ms));
  }
  const names = parseMdns(await runFor([dnssd, "-B", "_hue._tcp", "local"], ms)).map((f) => f.name!).filter(Boolean);
  const found: Found[] = [];
  for (const name of [...new Set(names)]) {
    const { host, port, id } = parseMdnsLookup(await runFor([dnssd, "-L", name, "_hue._tcp", "local"], ms));
    if (host && id) found.push({ id, ip: host, name, port, via: "mdns" });
  }
  return found;
}

/** `GET /api/0/config`: the bridge's name and id, no key needed. `cert` pins a self-signed bridge; without one only the root CA is trusted. */
export async function config(ip: string, tls: TlsOptions, timeoutMs = 4000): Promise<{ name: string; bridgeid: string; modelid?: string; apiversion?: string; swversion?: string }> {
  let res: Response;
  try {
    res = await fetch(`https://${ip}/api/0/config`, { signal: AbortSignal.timeout(timeoutMs), tls: tlsFor(tls) } as RequestInit);
  } catch (e) {
    throw fetchFailure(ip, e, timeoutMs);
  }
  if (!res.ok) throw new HueError(`${ip} answered ${res.status}`, "That is not a Hue bridge, or not one that speaks v2");
  const c = (await res.json()) as { name?: string; bridgeid?: string; modelid?: string; apiversion?: string; swversion?: string };
  if (!c.bridgeid) throw new HueError(`${ip} is not a Hue bridge`, "No bridge id in its answer");
  return { name: c.name ?? "Hue Bridge", bridgeid: c.bridgeid.toLowerCase(), modelid: c.modelid, apiversion: c.apiversion, swversion: c.swversion };
}

/** What the bridge's TLS certificate says, read over a raw TLS connection (no verification): pairing pins it and checks the CN is the bridge id. */
export function peekCertificate(ip: string, port?: number, timeoutMs = 4000): Promise<{ pem: string; cn: string; issuer: string; fingerprint: string; selfSigned: boolean }> {
  const hp = hostPort(ip, port);
  return new Promise((resolve, reject) => {
    const s = tlsConnect({ host: hp.host, port: hp.port, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const c = s.getPeerCertificate();
      s.end();
      if (!c || !c.raw) return reject(new HueError(`${ip} sent no certificate`, "Is it a Hue bridge?"));
      const b64 = Buffer.from(c.raw).toString("base64").replace(/(.{64})/g, "$1\n").trim();
      const cn = String(c.subject?.CN ?? "").toLowerCase(), issuer = String(c.issuer?.CN ?? "");
      resolve({ pem: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`, cn, issuer, fingerprint: String(c.fingerprint256 ?? ""), selfSigned: cn === issuer.toLowerCase() });
    });
    s.on("timeout", () => { s.destroy(); reject(new HueError(`${ip} did not answer in ${timeoutMs / 1000} s`, "Is the bridge on and on this network?")); });
    s.on("error", (e: Error) => reject(new HueError(`Could not reach ${ip}`, e.message)));
  });
}

/** One press-link attempt: `POST /api`; `null` while the button has not been pressed (error 101), the key once it has. */
export async function pressLink(ip: string, tls: TlsOptions, devicetype: string, timeoutMs = 4000): Promise<{ username: string; clientkey?: string } | null> {
  let res: Response;
  try {
    res = await fetch(`https://${ip}/api`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ devicetype, generateclientkey: true }), signal: AbortSignal.timeout(timeoutMs), tls: tlsFor(tls) } as RequestInit);
  } catch (e) {
    throw fetchFailure(ip, e, timeoutMs);
  }
  const body = (await res.json().catch(() => [])) as { success?: { username: string; clientkey?: string }; error?: { type?: number; description?: string } }[];
  const first = Array.isArray(body) ? body[0] : undefined;
  if (first?.success?.username) return first.success;
  if (first?.error?.type === 101) return null;
  throw new HueError(`${ip} refused the pairing`, first?.error?.description ?? `HTTP ${res.status}`);
}

/** `192.168.1.25` or `host:port` (a test bridge on a high port) as the pair `tls.connect` takes; 443 unless said. */
export function hostPort(ip: string, port?: number): { host: string; port: number } {
  const m = /^(.+):(\d+)$/.exec(ip);
  return m ? { host: m[1], port: Number(m[2]) } : { host: ip, port: port ?? 443 };
}

/** `pal#<host>`: Hue wants `app#device`, the app part at most 20 characters and the device part 19. */
export const devicetype = (host: string) => `pal#${host.replace(/[^a-z0-9-]/gi, "").slice(0, 19) || "pal"}`;
