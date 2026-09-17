// Home Assistant over its REST API: the client (every request with the
// settings' timeout), the wire shapes, and the pure helpers that turn a
// state into a row: domain glyph, state tone, accessories, the per-domain
// actions, and a service's field descriptions into a form. No pal imports,
// so the tests can drive these without a host.
import { errorMessage, tinted, type Accessory, type Action, type FormField, type Icon, type Item, type TagColor } from "@zcag/pal";

/** `[extensions.home-assistant]`, defaults in pal.json. */
export type Settings = {
  url: string; token: string; domains: string[]; favorites: string[]; timeout: number;
  /** Optional weather bar inputs. Empty entity ids deliberately disable that item. */
  temperature_entity?: string; weather_entity?: string; temperature_low?: number; temperature_high?: number; notable_conditions?: unknown[];
};

/** One entry of `/api/states`. */
export type State = { entity_id: string; state: string; attributes: Record<string, unknown>; last_changed: string; last_updated: string };
/** One field of a service's description; a `fields` of its own makes it a group (`collapsed` ones are HA's "advanced" section). */
type ServiceField = { name?: string; description?: string; example?: unknown; required?: boolean; selector?: Record<string, unknown>; fields?: Record<string, ServiceField>; collapsed?: boolean };
export type Service = { name?: string | null; description?: string | null; fields?: Record<string, ServiceField>; target?: { entity?: { domain?: string[] }[] } };
/** One entry of `/api/services`. */
export type ServiceDomain = { domain: string; services: Record<string, Service> };

const SETTINGS_HINT = "Settings › Extensions › Home Assistant";

/** A request that did not work, with a one-line `hint` for the row. */
export class HaError extends Error {
  constructor(message: string, readonly hint: string) { super(message); }
}

export const domainOf = (id: string) => id.split(".")[0];
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** What is wrong with the settings before any request, or nothing. */
export function unconfigured(s: Settings): HaError | undefined {
  if (!s.url?.trim()) return new HaError("Home Assistant is not set up", `Set the URL and a long-lived token under ${SETTINGS_HINT}`);
  if (!/^https?:\/\//.test(s.url.trim())) return new HaError("The URL needs http:// or https://", `${s.url.trim()} is not a URL: fix it under ${SETTINGS_HINT}`);
  if (!s.token?.trim()) return new HaError("Token is not set", `Add a long-lived access token (HA: your profile, Security) under ${SETTINGS_HINT}`);
  if (/^(keychain|env):/.test(s.token)) return new HaError("The token did not resolve", `${s.token} has no value on this machine; pal's log says why. ${SETTINGS_HINT}`);
}

/** Origins already reported as redirecting, so the log says it once. */
const warned = new Set<string>();

export class Client {
  url: string;
  constructor(url: string, private readonly token: string, readonly timeoutMs: number) { this.url = url.trim().replace(/\/+$/, ""); }

  /**
   * One request. A redirect is followed by hand (one hop) with the token
   * kept: `fetch` drops Authorization when the origin changes, and an
   * `http://` URL behind a proxy that answers 301 to `https://` would look
   * like a bad token. The client keeps the redirected origin.
   */
  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, hop = 0): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/api/${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "manual",
      });
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      throw new HaError(timedOut ? `${this.url} did not answer within ${this.timeoutMs / 1000} s` : `Could not reach ${this.url}`, timedOut ? `Raise the timeout or check the URL under ${SETTINGS_HINT}` : `${errorMessage(e)}. Check the URL under ${SETTINGS_HINT}`);
    }
    const location = res.headers.get("location");
    if (res.status >= 301 && res.status <= 308 && location && hop < 1) {
      const target = new URL(location, `${this.url}/api/${path}`);
      const base = target.href.replace(/\/api\/.*$/, "");
      if (base !== this.url) {
        if (!warned.has(this.url)) { warned.add(this.url); console.error(`[home-assistant] ${this.url} redirects to ${base}; set that as the URL`); }
        this.url = base;
      }
      return this.request(method, path, body, hop + 1);
    }
    if (res.status === 401 || res.status === 403) throw new HaError("Home Assistant rejected the token", `Make a new long-lived access token (HA: your profile, Security) and set it under ${SETTINGS_HINT}`);
    if (!res.ok) throw new HaError(`Home Assistant answered ${res.status} for ${method} ${path}`, (await res.text()).slice(0, 200) || res.statusText);
    return (await res.json()) as T;
  }

  states() { return this.request<State[]>("GET", "states"); }
  state(id: string) { return this.request<State>("GET", `states/${id}`); }
  services() { return this.request<ServiceDomain[]>("GET", "services"); }
  /** Calls `domain.service`; the answer is the states the call changed. */
  call(domain: string, service: string, data: Record<string, unknown>) { return this.request<State[]>("POST", `services/${domain}/${service}`, data); }
  /**
   * Entity id to area name, one template render (`/api/template`): the
   * registry over the websocket is the heavy way. An HA without the
   * template API (or a token without it) rejects, and the caller goes on
   * without areas.
   */
  async areas(): Promise<Record<string, string>> {
    const template = "{% set ns = namespace(m={}) %}{% for a in areas() %}{% for e in area_entities(a) %}{% set ns.m = dict(ns.m, **{e: area_name(a)}) %}{% endfor %}{% endfor %}{{ ns.m | to_json }}";
    const map = await this.request<unknown>("POST", "template", { template });
    return map && typeof map === "object" && !Array.isArray(map) ? (map as Record<string, string>) : {};
  }
}

// ---- rows -----------------------------------------------------------------

/** Domain to Nerd Font glyph (Material Design names, `md-*` in nerd-fonts/glyphnames.json); the house for the rest. */
const GLYPH: Record<string, string> = {
  light: "\u{f0335}", switch: "\u{f0521}", input_boolean: "\u{f0521}", fan: "\u{f0210}", climate: "\u{f050f}", humidifier: "\u{f1099}",
  media_player: "\u{f04c3}", cover: "\u{f111c}", lock: "\u{f033e}", scene: "\u{f03d8}", script: "\u{f0bc2}", automation: "\u{f06a9}",
  sensor: "\u{f029a}", binary_sensor: "\u{f043e}", person: "\u{f0004}", device_tracker: "\u{f0004}", zone: "\u{f034e}", camera: "\u{f0100}",
  weather: "\u{f0595}", sun: "\u{f0599}", vacuum: "\u{f070d}", button: "\u{f12a8}", input_button: "\u{f12a8}", calendar: "\u{f00ed}",
  event: "\u{f009a}", todo: "\u{f0279}", update: "\u{f06b0}", number: "\u{f03a0}", input_number: "\u{f03a0}", select: "\u{f0279}",
  input_select: "\u{f0279}", remote: "\u{f0454}", conversation: "\u{f0b79}", image: "\u{f02e9}", text: "\u{f060e}", input_text: "\u{f060e}",
  time: "\u{f0150}", datetime: "\u{f0150}", date: "\u{f00ed}", notify: "\u{f0188}", tts: "\u{f0b79}", timer: "\u{f0150}",
};
export const HOUSE = "\u{f02dc}";
const UNLOCKED = "\u{f033f}";
/** A lit light's glyph carries its colour (`rgb_color`), amber when the light reports none. */
const LIT = "#f5b642";

const TONE: Record<string, TagColor> = {
  on: "green", playing: "green", home: "green", open: "green", heat: "green", cool: "blue", heat_cool: "green", cleaning: "green", locked: "green", opening: "amber", closing: "amber",
  off: "grey", idle: "grey", not_home: "grey", closed: "grey", paused: "grey", standby: "grey", docked: "grey", unlocked: "amber", unavailable: "red", unknown: "red",
};

export const icon = (s: State): Icon => {
  const d = domainOf(s.entity_id);
  if (d === "light" && s.state === "on") {
    const rgb = s.attributes.rgb_color;
    return tinted(GLYPH.light, Array.isArray(rgb) && rgb.length === 3 ? `#${rgb.map((c) => Math.max(0, Math.min(255, Number(c) || 0)).toString(16).padStart(2, "0")).join("")}` : LIT);
  }
  if (d === "lock" && s.state === "unlocked") return UNLOCKED;
  return GLYPH[d] ?? HOUSE;
};

/** The state as the row shows it: a coloured tag for a known state, else the value with its unit. */
export const stateText = (s: State) => {
  const unit = s.attributes.unit_of_measurement;
  return typeof unit === "string" && unit ? `${s.state} ${unit}` : s.state;
};
export const accessories = (s: State): Accessory[] => [
  TONE[s.state] ? { tag: s.state.replace(/_/g, " "), color: TONE[s.state] } : { text: stateText(s).slice(0, 28) },
  { date: s.last_changed },
];

const A = (id: string, title: string, extra: Partial<Action> = {}): Action => ({ id, title, ...extra });
const COMMON: Action[] = [
  A("copy_id", "Copy entity id", { shortcut: "cmd+c" }),
  A("attributes", "Show attributes", { shortcut: "cmd+shift+a" }),
  A("open_ha", "Open in Home Assistant", { shortcut: "cmd+o" }),
];
const TOGGLE = [A("toggle", "Toggle"), A("on", "Turn on"), A("off", "Turn off")];

/** The row's actions, the primary first; `COMMON` closes every list. */
export function actions(s: State): Action[] {
  const d = domainOf(s.entity_id);
  let own: Action[];
  switch (d) {
    case "light": own = [...TOGGLE, A("brightness", "Brightness", { shortcut: "cmd+b" })]; break;
    case "switch": case "fan": case "input_boolean": case "humidifier": own = TOGGLE; break;
    case "climate": own = [A("temperature", "Set temperature"), A("on", "Turn on"), A("off", "Turn off")]; break;
    case "cover": own = s.state === "open" ? [A("close", "Close"), A("open", "Open"), A("stop", "Stop")] : [A("open", "Open"), A("close", "Close"), A("stop", "Stop")]; break;
    case "lock": own = s.state === "locked"
      ? [A("unlock", "Unlock", { confirm: `Unlock ${name(s)}?` }), A("lock", "Lock", { confirm: `Lock ${name(s)}?` })]
      : [A("lock", "Lock", { confirm: `Lock ${name(s)}?` }), A("unlock", "Unlock", { confirm: `Unlock ${name(s)}?` })]; break;
    case "media_player": own = [A("play_pause", s.state === "playing" ? "Pause" : "Play"), A("next", "Next track"), A("previous", "Previous track"), A("volume", "Volume", { shortcut: "cmd+u" }), A("off", "Turn off")]; break;
    case "scene": own = [A("activate", "Activate")]; break;
    case "script": own = [A("run", "Run")]; break;
    case "automation": own = [A("trigger", "Trigger"), s.state === "on" ? A("off", "Disable") : A("on", "Enable")]; break;
    case "button": case "input_button": own = [A("press", "Press")]; break;
    case "vacuum": own = [A("start", "Start"), A("return_to_base", "Return to dock")]; break;
    default: own = [A("copy_value", "Copy value")];
  }
  return [...own, ...COMMON];
}

/** Action id to the service it calls on the row's domain; the rest of the ids are handled by hand. */
export const SERVICE: Record<string, string> = {
  toggle: "toggle", on: "turn_on", off: "turn_off", open: "open_cover", close: "close_cover", stop: "stop_cover", lock: "lock", unlock: "unlock",
  play_pause: "media_play_pause", next: "media_next_track", previous: "media_previous_track", activate: "turn_on", run: "turn_on", trigger: "trigger",
  press: "press", start: "start", return_to_base: "return_to_base",
};

export const name = (s: State) => (typeof s.attributes.friendly_name === "string" && s.attributes.friendly_name) || s.entity_id;

export function row(s: State, area?: string): Item {
  const d = domainOf(s.entity_id);
  return {
    id: s.entity_id,
    name: name(s),
    subtitle: area ? `${titleCase(d)} · ${area}` : titleCase(d),
    icon: icon(s),
    keywords: [s.entity_id, d, ...(area ? [area] : [])],
    accessories: accessories(s),
    actions: actions(s),
  };
}

/** Where "Open in Home Assistant" goes: the editor for an automation or script, the history page for the rest. */
export function haUrl(base: string, s: State): string {
  const d = domainOf(s.entity_id);
  if (d === "automation" && typeof s.attributes.id === "string") return `${base}/config/automation/edit/${s.attributes.id}`;
  if (d === "script") return `${base}/config/script/edit/${s.entity_id.slice(d.length + 1)}`;
  return `${base}/history?entity_id=${encodeURIComponent(s.entity_id)}`;
}

/**
 * Favourites first in their order, then the domains in the settings' order,
 * names sorted within. `filter`: `all` (the default) is the settings'
 * domains, `every` is every domain (the rest after the chosen ones), a
 * domain is that domain alone.
 */
export function order(states: State[], s: Settings, filter?: string): State[] {
  const fav = new Map(s.favorites.map((id, i) => [id, i]));
  const rank = new Map(s.domains.map((d, i) => [d, i]));
  const shown = states.filter((x) => (!filter || filter === "all" ? fav.has(x.entity_id) || rank.has(domainOf(x.entity_id)) : filter === "every" || domainOf(x.entity_id) === filter));
  const key = (x: State) => fav.get(x.entity_id) ?? 1e6 + (rank.get(domainOf(x.entity_id)) ?? 1e3);
  return shown.sort((a, b) => key(a) - key(b) || name(a).localeCompare(name(b)));
}

/** The attribute drill-in: the state first, then every attribute, values one line. */
export const asText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v) ?? String(v));
export function attributeRows(s: State): Item[] {
  const copy = [A("copy", "Copy value"), A("copy_key", "Copy name", { shortcut: "cmd+c" })];
  return [
    { id: "state", name: "state", subtitle: s.state, icon: icon(s), accessories: [{ date: s.last_changed }], actions: copy },
    ...Object.entries(s.attributes).map(([k, v]) => ({ id: k, name: k, subtitle: asText(v).slice(0, 200), icon: "\u{f060e}", actions: copy })),
  ];
}

// ---- services -------------------------------------------------------------

/** Every service as a row, by domain then name; `id` is `domain.service`. */
export function serviceRows(domains: ServiceDomain[]): Item[] {
  return [...domains].sort((a, b) => a.domain.localeCompare(b.domain)).flatMap((d) =>
    Object.entries(d.services).sort(([a], [b]) => a.localeCompare(b)).map(([key, svc]): Item => ({
      id: `${d.domain}.${key}`,
      name: svc.name || titleCase(key),
      subtitle: svc.description ? `${titleCase(d.domain)} · ${svc.description.split("\n")[0]}` : titleCase(d.domain),
      icon: GLYPH[d.domain] ?? "\u{f0241}",
      keywords: [d.domain, key, `${d.domain}.${key}`],
      accessories: [{ text: `${d.domain}.${key}` }],
      actions: [A("call", "Call"), A("copy_id", "Copy service id", { shortcut: "cmd+c" })],
    })));
}

/** A service's fields flattened: a group's fields inline, a `collapsed` group (HA's advanced section) left out. */
export function flatFields(fields: Record<string, ServiceField> = {}): [string, ServiceField][] {
  return Object.entries(fields).flatMap(([k, f]) => (f.fields ? (f.collapsed ? [] : flatFields(f.fields)) : [[k, f] as [string, ServiceField]]));
}

/** What a selector says the value is, for the form and for coercing what was typed back. */
export const selectorKind = (f: ServiceField): string => Object.keys(f.selector ?? {})[0] ?? "text";

const selectOptions = (sel: unknown): { id: string; title: string }[] => {
  const opts = (sel as { options?: unknown })?.options;
  return Array.isArray(opts) ? opts.map((o) => (o && typeof o === "object" ? { id: String((o as { value: unknown }).value), title: String((o as { label?: unknown }).label ?? (o as { value: unknown }).value) } : { id: String(o), title: String(o) })) : [];
};

/** One form field per service field: a select for a `select` selector, a checkbox for `boolean`, text otherwise (the example as placeholder). */
export function serviceFormField(key: string, f: ServiceField): FormField {
  const kind = selectorKind(f);
  const sel = f.selector?.[kind] as Record<string, unknown> | undefined;
  const base = { id: key, label: f.name || titleCase(key), required: !!f.required, description: f.description?.split("\n")[0] };
  if (kind === "select") return { ...base, kind: "select", options: selectOptions(sel) };
  if (kind === "boolean") return { ...base, kind: "checkbox", text: "Yes", default: f.example === true || f.example === "true" };
  const hints: string[] = [];
  if (kind === "number" && sel) {
    const range = [sel.min, sel.max].map((v) => (typeof v === "number" ? v : undefined));
    if (range[0] !== undefined || range[1] !== undefined) hints.push(`${range[0] ?? ""}..${range[1] ?? ""}`);
    if (typeof sel.unit_of_measurement === "string") hints.push(sel.unit_of_measurement);
  }
  if (kind === "object" || (kind === "entity" && (sel as { multiple?: boolean })?.multiple)) hints.push("JSON or comma separated");
  const description = [base.description, hints.length ? `(${hints.join(" ")})` : ""].filter(Boolean).join(" ") || undefined;
  return { ...base, description, kind: "text", placeholder: f.example === undefined ? undefined : asText(f.example) };
}

/** A typed value back into what the service expects: numbers, JSON for objects and lists, else the string. */
export function coerce(kind: string, v: string | boolean): unknown {
  if (typeof v === "boolean") return v;
  const s = v.trim();
  if (kind === "number") return Number(s);
  if (kind === "boolean") return s === "true" || s === "on" || s === "yes";
  if (kind === "object" || /^[\[{]/.test(s)) { try { return JSON.parse(s); } catch { /* the string as typed */ } }
  if ((kind === "entity" || kind === "device" || kind === "area") && s.includes(",")) return s.split(",").map((x) => x.trim()).filter(Boolean);
  return s;
}

/** Which entities a service's target takes: those of its domains, every entity when it names none, nothing when it has no target. */
export function targets(svc: Service, states: State[]): State[] | undefined {
  if (!svc.target?.entity) return undefined;
  const domains = new Set(svc.target.entity.flatMap((t) => t.domain ?? []));
  return states.filter((s) => domains.size === 0 || domains.has(domainOf(s.entity_id)));
}
