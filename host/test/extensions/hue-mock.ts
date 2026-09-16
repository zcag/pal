// A Hue bridge for the tests: the CLIP v2 routes the extension uses over
// https with a self-signed certificate (as an old bridge has, so pairing
// pins it), `POST /api` press-link (the button is `press()`), the event
// stream fed by every PUT and by `emit`, and the cloud discovery endpoint.
// The home is `extensions/hue/sample.ts`, deep-copied per mock.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Resource } from "../../../extensions/hue/api.ts";
import { deepMerge } from "../../../extensions/hue/model.ts";
import { SAMPLE_BRIDGE_ID, SAMPLE_KEY, SAMPLE_RESOURCES } from "../../../extensions/hue/sample.ts";

/** A self-signed P-256 certificate with the bridge id as its CN, made with openssl (on every macOS and the CI image). */
export function selfSigned(cn: string): { cert: string; key: string } {
  const dir = mkdtempSync(join(tmpdir(), "pal-hue-tls-"));
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "2", "-subj", `/C=NL/O=Philips Hue/CN=${cn}`], { stdio: "ignore" });
    return { cert: readFileSync(join(dir, "cert.pem"), "utf8"), key: readFileSync(join(dir, "key.pem"), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export type MockOptions = { key?: string; bridgeId?: string; name?: string; tls?: { cert: string; key: string } | false; resources?: Resource[] };

export class MockBridge {
  readonly resources: Resource[];
  readonly key: string;
  readonly bridgeId: string;
  readonly name: string;
  /** Every request the extension made, in order. */
  readonly calls: { method: string; path: string; body?: unknown; key?: string | null }[] = [];
  /** Every PUT, as `type/id` with its body. */
  readonly puts: { type: string; id: string; body: Record<string, unknown> }[] = [];
  /** Press-link attempts so far. */
  pairAttempts = 0;
  /** `press()` arms the button; the next `POST /api` succeeds. */
  private armed = false;
  private clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private seq = 0;
  private server: ReturnType<typeof Bun.serve>;
  readonly tls?: { cert: string; key: string };

  constructor(o: MockOptions = {}) {
    this.resources = structuredClone(o.resources ?? SAMPLE_RESOURCES);
    this.key = o.key ?? SAMPLE_KEY;
    this.bridgeId = o.bridgeId ?? SAMPLE_BRIDGE_ID;
    this.name = o.name ?? "Hue Bridge";
    this.tls = o.tls === false ? undefined : o.tls ?? selfSigned(this.bridgeId);
    this.server = Bun.serve({ port: 0, hostname: "127.0.0.1", ...(this.tls && { tls: this.tls }), fetch: (req) => this.handle(req) });
  }

  get port(): number { return this.server.port!; }
  get ip() { return `127.0.0.1:${this.server.port}`; }
  get url() { return `${this.tls ? "https" : "http"}://${this.ip}`; }

  press() { this.armed = true; }
  find(id: string) { return this.resources.find((r) => r.id === id) as (Resource & Record<string, any>) | undefined; }

  /** One event to every stream client; the `data` items are partial resources. */
  emit(type: "update" | "add" | "delete", data: Resource[]) {
    const ev = { creationtime: new Date().toISOString(), data, id: `ev-${++this.seq}`, type };
    const line = `id: ${Math.floor(Date.now() / 1000)}:0\ndata: ${JSON.stringify([ev])}\n\n`;
    for (const c of this.clients) { try { c.enqueue(new TextEncoder().encode(line)); } catch { this.clients.delete(c); } }
  }

  /** Apply a change as a PUT would (merged into the resource) and stream it: what another app does. */
  change(id: string, patch: Record<string, unknown>) {
    const i = this.resources.findIndex((r) => r.id === id);
    if (i < 0) throw new Error(`no resource ${id}`);
    this.resources[i] = deepMerge(this.resources[i], patch) as Resource;
    this.emit("update", [{ id, type: this.resources[i].type, ...patch }]);
  }

  get streamClients() { return this.clients.size; }

  stop() { for (const c of this.clients) { try { c.close(); } catch { /* gone */ } } this.server.stop(true); }

  private async handle(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const key = req.headers.get("hue-application-key");
    let body: unknown;
    if (req.method !== "GET") { try { body = await req.json(); } catch { body = undefined; } }
    this.calls.push({ method: req.method, path: u.pathname, body, key });
    if (u.pathname === "/api/0/config") return Response.json({ name: this.name, datastoreversion: "197", swversion: "1978293000", apiversion: "1.78.0", mac: "ec:b5:fa:00:00:01", bridgeid: this.bridgeId.toUpperCase(), factorynew: false, replacesbridgeid: null, modelid: "BSB002", starterkitid: "" });
    if (u.pathname === "/api" && req.method === "POST") {
      this.pairAttempts++;
      const b = body as { devicetype?: string; generateclientkey?: boolean } | undefined;
      if (!b?.devicetype) return Response.json([{ error: { type: 5, address: "/", description: "invalid/missing parameters in body" } }]);
      if (!this.armed) return Response.json([{ error: { type: 101, address: "", description: "link button not pressed" } }]);
      this.armed = false;
      return Response.json([{ success: { username: this.key, ...(b.generateclientkey && { clientkey: "0123456789ABCDEF0123456789ABCDEF" }) } }]);
    }
    if (key !== this.key) return Response.json({ errors: [{ description: "unauthorized" }] }, { status: 403 });
    if (u.pathname === "/eventstream/clip/v2") {
      const clients = this.clients;
      let ctl: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) { ctl = c; clients.add(c); c.enqueue(new TextEncoder().encode(": hi\n\n")); },
        cancel() { clients.delete(ctl); },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
    }
    const m = /^\/clip\/v2\/resource(?:\/([a-z_]+))?(?:\/([^/]+))?$/.exec(u.pathname);
    if (!m) return Response.json({ errors: [{ description: "not found" }] }, { status: 404 });
    const [, type, id] = m;
    if (req.method === "GET") {
      const list = this.resources.filter((r) => (!type || r.type === type) && (!id || r.id === id));
      if (id && !list.length) return Response.json({ errors: [{ description: `resource ${id} not found` }], data: [] }, { status: 404 });
      return Response.json({ errors: [], data: list });
    }
    if (req.method === "PUT" && type && id) {
      const i = this.resources.findIndex((r) => r.id === id && r.type === type);
      if (i < 0) return Response.json({ errors: [{ description: `resource ${id} not found` }], data: [] }, { status: 404 });
      const patch = (body ?? {}) as Record<string, unknown>;
      this.puts.push({ type, id, body: patch });
      const { dynamics, recall, alert, action, ...state } = patch;
      // The bridge reports a set effect as `effects.status`.
      const fx = (state.effects as { effect?: string } | undefined)?.effect;
      if (fx) state.effects = { status: fx };
      const changed: Resource[] = [];
      const apply = (rid: string, p: Record<string, unknown>) => {
        const j = this.resources.findIndex((r) => r.id === rid);
        if (j < 0) return;
        this.resources[j] = deepMerge(this.resources[j], p) as Resource;
        changed.push({ id: rid, type: this.resources[j].type, ...p });
      };
      if (type === "grouped_light") {
        // The group's state, then every member light (a room's devices' lights, a zone's lights).
        apply(id, state);
        const owner = (this.resources[i] as any).owner as { rid: string; rtype: string };
        const group = this.find(owner.rid) as any;
        for (const c of (group?.children ?? []) as { rid: string; rtype: string }[]) {
          if (c.rtype === "light") apply(c.rid, state);
          else for (const s of ((this.find(c.rid) as any)?.services ?? []) as { rid: string; rtype: string }[]) if (s.rtype === "light") apply(s.rid, state);
        }
      } else if (type === "scene" && recall) {
        const act = (recall as { action?: string }).action;
        for (const a of ((this.resources[i] as any).actions ?? []) as { target: { rid: string }; action: Record<string, unknown> }[]) apply(a.target.rid, a.action);
        apply(id, { status: { active: act === "dynamic_palette" ? "dynamic_palette" : "static" } });
      } else if (type === "smart_scene" && recall) {
        apply(id, { state: (recall as { action?: string }).action === "activate" ? "active" : "inactive" });
      } else if (type === "entertainment_configuration" && action) {
        apply(id, { status: action === "start" ? "active" : "inactive" });
      } else {
        apply(id, state);
      }
      if (changed.length) this.emit("update", changed);
      return Response.json({ errors: [], data: [{ rid: id, rtype: type }] });
    }
    return Response.json({ errors: [{ description: "method not allowed" }] }, { status: 405 });
  }
}

/** The cloud discovery endpoint, answering the given bridges. */
export function discoveryServer(bridges: { id: string; ip: string; port: number }[]) {
  return Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json(bridges.map((b) => ({ id: b.id, internalipaddress: b.ip, port: b.port }))) });
}
