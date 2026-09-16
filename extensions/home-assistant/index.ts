// Home Assistant: entities as rows (live, so the states at the root are
// current), services as forms, areas as drill-ins. Everything is the REST
// API in ha.ts with the settings' URL, token and timeout; a request that
// fails is one hint row with the fix, never an error.
import { settings, type Ctx, type Detail, type Effect, type Extension, type Form, type Item } from "@zcag/pal";
import { actions, asText, attributeRows, Client, coerce, domainOf, flatFields, HaError, HOUSE, haUrl, icon, name, order, row, selectorKind, SERVICE, serviceFormField, serviceRows, stateText, targets, titleCase, unconfigured, type Service, type ServiceDomain, type Settings, type State } from "./ha.ts";

const EXTENSION = "home-assistant";
/** `ctx.args` of the entities palette's drill-ins. */
type Args = { attributes?: string; brightness?: string; volume?: string; area?: string };
const AREAS_TTL = 10 * 60_000;
const PRESETS = [10, 25, 50, 75, 100];

let areaCache: { at: number; map: Record<string, string> } | undefined;

/** The client for the current settings, or the error a hint row shows. */
function client(): Client {
  const s = settings.get<Settings>();
  const bad = unconfigured(s);
  if (bad) throw bad;
  return new Client(s.url, s.token, Math.max(1, Number(s.timeout) || 5) * 1000);
}

/** The one row a broken setup lists: inert, with the fix in the subtitle. */
const hint = (e: unknown): Item[] => [{
  id: "hint",
  name: e instanceof HaError ? e.message : `Home Assistant: ${e instanceof Error ? e.message : e}`,
  subtitle: e instanceof HaError ? e.hint : undefined,
  icon: "\u{f0026}",
  actions: [],
}];
const failed = (what: string, e: unknown): Effect => ({ keep: true, toast: { title: `Could not ${what}`, message: e instanceof HaError ? `${e.message}. ${e.hint}` : String((e as Error)?.message ?? e), style: "failure" } });

/** Entity id to area name, kept ten minutes; an HA that refuses the template API leaves the rows without areas. */
async function areas(c: Client, refresh = false): Promise<Record<string, string>> {
  if (!refresh && areaCache && Date.now() - areaCache.at < AREAS_TTL) return areaCache.map;
  let map: Record<string, string> = {};
  try { map = await c.areas(); } catch (e) { console.error(`home-assistant: areas: ${e instanceof Error ? e.message : e}`); }
  areaCache = { at: Date.now(), map };
  return map;
}

/** One service call from a row; the toast names what changed. */
async function call(c: Client, id: string, service: string, data: Record<string, unknown> = {}): Promise<Effect> {
  const domain = domainOf(id);
  try {
    const changed = await c.call(domain, service, { entity_id: id, ...data });
    const me = changed.find((s) => s.entity_id === id);
    return { keep: true, toast: { title: me ? `${name(me)}: ${stateText(me)}` : `${titleCase(domain)}.${service} sent`, style: "success" } };
  } catch (e) {
    return failed(`${service.replace(/_/g, " ")} ${id}`, e);
  }
}

/** The preset rows of a brightness or volume level: the current value tagged. */
function presetRows(s: State, kind: "brightness" | "volume"): Item[] {
  const raw = kind === "brightness" ? (typeof s.attributes.brightness === "number" ? Math.round((s.attributes.brightness / 255) * 100) : s.state === "off" ? 0 : undefined) : typeof s.attributes.volume_level === "number" ? Math.round(s.attributes.volume_level * 100) : undefined;
  const rows: Item[] = PRESETS.map((p) => ({ id: String(p), name: `${p}%`, icon: kind === "brightness" ? "\u{f00df}" : "\u{f057e}", accessories: raw !== undefined && Math.abs(raw - p) < 5 ? [{ tag: "current", color: "blue" }] : undefined, actions: [{ id: "set", title: kind === "brightness" ? "Set brightness" : "Set volume" }] }));
  return [
    { id: "current", name: name(s), subtitle: raw === undefined ? stateText(s) : `${kind === "brightness" ? "Brightness" : "Volume"} ${raw}%`, icon: icon(s), actions: [] },
    ...rows,
  ];
}

const temperatureForm = (s: State, errors?: Record<string, string>): Form => {
  const modes = Array.isArray(s.attributes.hvac_modes) ? (s.attributes.hvac_modes as string[]) : [];
  const [min, max] = [s.attributes.min_temp, s.attributes.max_temp].map((v) => (typeof v === "number" ? v : undefined));
  return {
    id: s.entity_id,
    title: `Set ${name(s)}`,
    fields: [
      { kind: "text", id: "temperature", label: "Temperature", required: true, default: s.attributes.temperature === undefined || s.attributes.temperature === null ? "" : String(s.attributes.temperature), placeholder: "21", description: min !== undefined && max !== undefined ? `${min}..${max}${typeof s.attributes.temperature_unit === "string" ? " " + s.attributes.temperature_unit : ""}` : undefined },
      ...(modes.length ? [{ kind: "select" as const, id: "hvac_mode", label: "Mode", options: modes.map((m) => ({ id: m, title: titleCase(m) })), default: modes.includes(s.state) ? s.state : modes[0] }] : []),
    ],
    submit: { id: "set_temperature", title: "Set" },
    errors,
  };
};

/** The form for one service: the target as a select of the matching entities, then its fields. */
async function serviceForm(c: Client, id: string, errors?: Record<string, string>): Promise<Form> {
  const [domain, key] = [domainOf(id), id.slice(id.indexOf(".") + 1)];
  const [services, states] = await Promise.all([c.services(), c.states()]);
  const svc = services.find((d) => d.domain === domain)?.services[key];
  if (!svc) throw new HaError(`No service ${id}`, "Refresh the list with cmd+r");
  const entities = targets(svc, states);
  return {
    id,
    title: svc.name || `${titleCase(domain)}: ${titleCase(key)}`,
    fields: [
      ...(entities ? [{ kind: "select" as const, id: "entity_id", label: "Entity", required: true, options: entities.sort((a, b) => name(a).localeCompare(name(b))).map((s) => ({ id: s.entity_id, title: `${name(s)} (${s.entity_id})` })) }] : []),
      ...flatFields(svc.fields).map(([k, f]) => serviceFormField(k, f)),
    ],
    submit: { id: "call", title: `Call ${id}` },
    errors,
  };
}

async function callService(c: Client, id: string, ctx?: Ctx): Promise<Effect> {
  const [domain, key] = [domainOf(id), id.slice(id.indexOf(".") + 1)];
  const values = ctx?.values ?? {};
  let svc: Service | undefined;
  try { svc = (await c.services()).find((d: ServiceDomain) => d.domain === domain)?.services[key]; } catch (e) { return failed(`call ${id}`, e); }
  const kinds = Object.fromEntries(flatFields(svc?.fields).map(([k, f]) => [k, selectorKind(f)]));
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === "" || v === false) continue;
    const kind = kinds[k] ?? "text";
    const value = coerce(kind, v);
    if (kind === "number" && Number.isNaN(value)) { errors[k] = "Not a number"; continue; }
    data[k] = value;
  }
  if (Object.keys(errors).length) return { form: await serviceForm(c, id, errors) };
  try {
    const changed = await c.call(domain, key, data);
    return { toast: { title: `Called ${id}`, message: changed.length ? `${changed.length} ${changed.length === 1 ? "entity" : "entities"} changed: ${changed.map(name).join(", ").slice(0, 120)}` : undefined, style: "success" } };
  } catch (e) {
    return failed(`call ${id}`, e);
  }
}

/** A pick on an entity row or one of its drill-ins; a request that fails is a toast, so the caller wraps this. */
async function pickEntity(id: string, action: string | undefined, ctx: Ctx | undefined): Promise<Effect | void> {
  const args = (ctx?.args ?? {}) as Args;
  if (id === "hint") return;
  const c = client();
  // The attribute level: every row copies its value (or its name).
  if (args.attributes) {
    const s = await c.state(args.attributes);
    return { copy: action === "copy_key" ? id : id === "state" ? s.state : asText(s.attributes[id]) };
  }
  if (args.brightness) return id === "current" ? undefined : call(c, args.brightness, "turn_on", { brightness_pct: Number(id) });
  if (args.volume) return id === "current" ? undefined : call(c, args.volume, "volume_set", { volume_level: Number(id) / 100 });
  // No action id (an item hotkey, a bare pick): the row's primary action.
  const act = action ?? actions(await c.state(id))[0].id;
  switch (act) {
    case "set_temperature": {
      const v = ctx?.values ?? {};
      const t = Number(String(v.temperature ?? "").trim());
      if (!String(v.temperature ?? "").trim() || Number.isNaN(t)) return { form: temperatureForm(await c.state(id), { temperature: "Not a number" }) };
      return call(c, id, "set_temperature", { temperature: t, ...(v.hvac_mode ? { hvac_mode: v.hvac_mode } : {}) });
    }
    case "temperature": return { form: temperatureForm(await c.state(id)) };
    case "brightness": return { push: { extension: EXTENSION, palette: "entities", args: { brightness: id } } };
    case "volume": return { push: { extension: EXTENSION, palette: "entities", args: { volume: id } } };
    case "attributes": return { push: { extension: EXTENSION, palette: "entities", args: { attributes: id } } };
    case "copy_id": return { copy: id };
    case "copy_value": return { copy: (await c.state(id)).state };
    case "open_ha": { const s = await c.state(id); return { open: haUrl(c.url, s) }; }
  }
  const service = SERVICE[act];
  if (!service) return failed(act, new Error("unknown action"));
  return call(c, id, service);
}

export default {
  palettes: {
    entities: {
      title: "Home Assistant",
      icon: "\u{f07d0}",
      live: true,
      placeholder: "Search entities",
      filters: [
        { id: "all", title: "All entities" }, { id: "every", title: "Every domain" }, { id: "light", title: "Lights" }, { id: "switch", title: "Switches" }, { id: "sensor", title: "Sensors" },
        { id: "binary_sensor", title: "Binary sensors" }, { id: "climate", title: "Climate" }, { id: "media_player", title: "Media players" },
        { id: "person", title: "People" }, { id: "script", title: "Scripts" }, { id: "automation", title: "Automations" }, { id: "scene", title: "Scenes" },
      ],
      list: async (_query, ctx): Promise<Item[]> => {
        const args = (ctx?.args ?? {}) as Args;
        let c: Client;
        try { c = client(); } catch (e) { return hint(e); }
        try {
          if (args.attributes) return attributeRows(await c.state(args.attributes));
          if (args.brightness) return presetRows(await c.state(args.brightness), "brightness");
          if (args.volume) return presetRows(await c.state(args.volume), "volume");
          const [states, map] = await Promise.all([c.states(), areas(c, ctx?.refresh)]);
          const s = settings.get<Settings>();
          if (args.area) return states.filter((x) => map[x.entity_id] === args.area).sort((a, b) => name(a).localeCompare(name(b))).map((x) => row(x, args.area));
          return order(states, s, ctx?.filter).map((x) => row(x, map[x.entity_id]));
        } catch (e) {
          return hint(e);
        }
      },
      pick: async (id, action, ctx): Promise<Effect | void> => {
        try { return await pickEntity(id, action, ctx); } catch (e) { return failed(`reach Home Assistant for ${id}`, e); }
      },
      detail: async (id, ctx): Promise<Detail | void> => {
        if ((ctx?.args as Args | undefined)?.attributes || id === "hint" || /^\d+$/.test(id) || id === "current") return;
        let s: State;
        try { s = await client().state(id); } catch { return; }
        const shown = Object.entries(s.attributes).filter(([k]) => k !== "friendly_name").slice(0, 12);
        return {
          metadata: [
            { label: "Entity", value: s.entity_id },
            { label: "State", value: stateText(s) },
            { label: "Changed", value: new Date(s.last_changed).toLocaleString() },
            ...shown.map(([k, v]) => ({ label: titleCase(k), value: asText(v).slice(0, 80) })),
          ],
        };
      },
    },
    services: {
      title: "Home Assistant Services",
      icon: "\u{f0241}",
      placeholder: "Search services",
      list: async (): Promise<Item[]> => {
        try { return serviceRows(await client().services()); } catch (e) { return hint(e); }
      },
      pick: async (id, action, ctx): Promise<Effect | void> => {
        if (id === "hint") return;
        if (action === "copy_id") return { copy: id };
        let c: Client;
        try { c = client(); } catch (e) { return failed("reach Home Assistant", e); }
        if (action === "call" && ctx?.values) return callService(c, id, ctx);
        try { return { form: await serviceForm(c, id) }; } catch (e) { return failed(`describe ${id}`, e); }
      },
    },
    areas: {
      title: "Home Assistant Areas",
      icon: HOUSE,
      placeholder: "Search areas",
      list: async (): Promise<Item[]> => {
        let c: Client;
        try { c = client(); } catch (e) { return hint(e); }
        try {
          const map = await c.areas();
          areaCache = { at: Date.now(), map };
          const counts = new Map<string, number>();
          for (const a of Object.values(map)) counts.set(a, (counts.get(a) ?? 0) + 1);
          return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([area, n]) => ({ id: area, name: area, subtitle: `${n} ${n === 1 ? "entity" : "entities"}`, icon: HOUSE, keywords: ["area"], actions: [{ id: "open", title: "Show entities" }] }));
        } catch (e) {
          return hint(e);
        }
      },
      pick: (id): Effect | void => (id === "hint" ? undefined : { push: { extension: EXTENSION, palette: "entities", args: { area: id } } }),
    },
  },
} satisfies Extension;
