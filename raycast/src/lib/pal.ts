import { Cache, getPreferenceValues } from "@raycast/api";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type Accessory = {
  text?: string | { value?: string; color?: string };
  tag?: string | { value?: string; color?: string };
  date?: string | { value?: string; color?: string };
  icon?: string;
  color?: string;
  tooltip?: string;
};

export type MetadataEntry = {
  label?: string;
  text?: string;
  link?: string;
  tags?: Array<string | { text?: string; color?: string }>;
  icon?: string;
  color?: string;
  separator?: boolean;
};

export type ItemDetail = {
  markdown?: string;
  metadata?: MetadataEntry[];
};

export type PalAction = {
  id?: string;
  title?: string;
  icon?: string;
  shortcut?: string;
  style?: "regular" | "destructive";
  confirm?: string;
  action?: string;
  value?: string;
  key?: string;
  reload?: boolean;
  primary?: boolean;
};

export type PalItem = {
  id: string;
  name: string;
  subtitle?: string;
  desc?: string;
  keywords?: string[];
  icon?: string;
  icon_xdg?: string;
  icon_utf?: string;
  icon_rc?: string;
  color?: string;
  section?: string;
  accessories?: Accessory[];
  detail?: ItemDetail;
  preview?: string;
  actions?: PalAction[];
  quicklook?: { name?: string; path: string };
  /** Hover text for the item's icon in a rich frontend. */
  tooltip?: string;
  /** Round the item's image: "circle" (avatars) or "rounded". */
  mask?: string;
  url?: string;
  // Palettes are free-form; everything else rides along and shows up as PAL_*.
  [key: string]: unknown;
};

/** Presentation hints from a palette's `[display]` block. */
export type PaletteDisplay = {
  detail?: boolean;
  columns?: number | null;
  aspect?: string | null;
  fit?: string | null;
  inset?: string | null;
};

/** One entry of a palette's scope dropdown, from its `[[filter]]` entries. */
export type PaletteFilter = {
  id: string;
  name?: string | null;
  icon?: string | null;
  icon_xdg?: string | null;
};

export type PaletteMeta = {
  name: string;
  desc?: string | null;
  base?: string | null;
  icon?: string | null;
  icon_xdg?: string | null;
  icon_utf?: string | null;
  view: "list" | "grid";
  display?: PaletteDisplay | null;
  filters?: PaletteFilter[] | null;
  input: boolean;
  input_prompt?: string | null;
  live: boolean;
  cache: boolean;
  ttl?: number | null;
  auto_list: boolean;
  auto_pick: boolean;
  default_action?: string | null;
  action_key?: string | null;
  actions: PalAction[];
  include: string[];
};

export type PalMeta = {
  default_palette: string;
  default_frontend: string;
  frontends: string[];
  palettes: PaletteMeta[];
};

/** The envelope a pick may return. Anything else is treated as plain output. */
export type Envelope = {
  toast?: { style?: string; title?: string; message?: string };
  hud?: string;
  clipboard?: string;
  open?: string;
  show?: ItemDetail;
  reload?: boolean;
  close?: boolean;
  /** The pick resolved to another palette (the `pals` palette does this). */
  palette?: string;
  /** Environment that palette should be listed with - a scoped drill-down. */
  env?: Record<string, string>;
};

const prefs = () =>
  getPreferenceValues<{ palPath?: string; configPath?: string }>();

const cache = new Cache({ namespace: "pal-env" });

/** The PATH we resolved on a previous run, if any. Cache is synchronous. */
export function cachedShellPath(): string | undefined {
  return cache.get("path");
}

/**
 * Raycast's node runtime gets a minimal PATH, but pal's plugins shell out to
 * jq, bt, abre, gh and friends. Resolve the login shell's PATH once and reuse
 * it - paying for a login shell on every call costs a few hundred ms.
 */
export async function shellPath(): Promise<string> {
  const cached = cache.get("path");
  if (cached) return cached;

  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const { stdout } = await exec(shell, ["-lc", "printf %s \"$PATH\""], {
      timeout: 5000,
      env: { ...process.env, TERM: "dumb" },
    });
    const path = stdout.trim();
    if (path) {
      cache.set("path", path);
      return path;
    }
  } catch {
    // fall through to the default below
  }
  return process.env.PATH ?? "";
}

/** Forget the cached PATH - used by the "Reload pal Environment" action. */
export function clearShellPath() {
  cache.remove("path");
}

async function env() {
  return { ...process.env, PATH: await shellPath() };
}

function baseArgs(): string[] {
  const { configPath } = prefs();
  return configPath?.trim() ? ["--config", configPath.trim()] : [];
}

export function palBinary(): string {
  const { palPath } = prefs();
  return palPath?.trim() || "pal";
}

/** Run pal and return stdout. Throws with stderr attached on failure. */
export async function runPal(
  args: string[],
  options: { input?: string; timeout?: number } = {},
): Promise<string> {
  try {
    const running = exec(palBinary(), [...baseArgs(), ...args], {
      env: await env(),
      timeout: options.timeout ?? 30_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    // execFile has no `input` option - the child's stdin is a pipe nothing
    // ever writes to or closes, so a pal subcommand that reads an item from
    // stdin blocks until the timeout kills it. Feed and close it by hand.
    if (options.input !== undefined) running.child.stdin?.end(options.input);
    const { stdout } = await running;
    return String(stdout);
  } catch (error) {
    const err = error as { stderr?: string; message?: string; code?: string };
    if (err.code === "ENOENT") {
      throw new Error(
        `Could not find the \`${palBinary()}\` binary. Set its full path in this command's preferences.`,
      );
    }
    throw new Error((err.stderr || err.message || String(error)).trim());
  }
}

export function listArgs(palette: string, query?: string, filter?: string): string[] {
  const args = [...baseArgs(), "list", palette];
  if (query) args.push("--query", query);
  if (filter) args.push("--filter", filter);
  return args;
}

export function metaArgs(palette?: string): string[] {
  return [...baseArgs(), "meta", ...(palette ? [palette] : [])];
}

/** Parse `pal list` output - JSON lines, skipping anything unparseable. */
export function parseItems(stdout: string): PalItem[] {
  const items: PalItem[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const item = JSON.parse(trimmed) as PalItem;
      if (!item.id) item.id = item.name ?? String(items.length);
      items.push(item);
    } catch {
      // A plugin printed something that isn't an item; ignore it rather than
      // failing the whole palette.
    }
  }
  return items;
}

/**
 * `pal meta` output, or a readable error. A bare JSON.parse turns every way of
 * failing to run pal - not on PATH, non-zero exit, a plugin writing to stdout -
 * into "Unexpected end of JSON input", which says nothing about the cause.
 */
function parseJSON<T>(what: string, out: string | { stdout: string; stderr?: string }): T {
  const stdout = typeof out === "string" ? out : out.stdout;
  const stderr = typeof out === "string" ? "" : (out.stderr ?? "");
  if (!stdout.trim()) {
    const why = stderr.trim() || "no output and no error - is `pal` on PATH?";
    throw new Error(`Could not read ${what}: ${why}`);
  }
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`${what} was not valid JSON: ${stdout.trim().slice(0, 200)}`);
  }
}

export function parseMeta(out: string | { stdout: string; stderr?: string }): PalMeta {
  return parseJSON<PalMeta>("pal meta", out);
}

export function parsePaletteMeta(out: string | { stdout: string; stderr?: string }): PaletteMeta {
  return parseJSON<PaletteMeta>("the palette's meta", out);
}

/** Run a pick and return whatever it produced. */
export async function pick(
  palette: string,
  item: PalItem,
  actionId?: string,
): Promise<string> {
  const args = ["pick", palette];
  if (actionId) args.push("--action", actionId);
  return runPal(args, { input: JSON.stringify(item) });
}

const ENVELOPE_KEYS = ["toast", "hud", "clipboard", "open", "show", "reload", "close", "palette"];

/** Recognise a result envelope; plain output comes back as null. */
export function parseEnvelope(output: string): Envelope | null {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof value !== "object" || value === null) return null;
    return ENVELOPE_KEYS.some((k) => k in value) ? (value as Envelope) : null;
  } catch {
    return null;
  }
}

/** The actions an item offers, falling back to the palette's defaults. */
export function actionsFor(item: PalItem, meta?: PaletteMeta): PalAction[] {
  if (item.actions?.length) return item.actions;
  if (meta?.actions?.length) return meta.actions;
  return [];
}

/** The value a pick will act on, used for the "copy value" affordance. */
export function itemValue(item: PalItem, meta?: PaletteMeta): string | undefined {
  const key = meta?.action_key;
  if (key && typeof item[key] === "string") return item[key] as string;
  if (typeof item.url === "string") return item.url;
  if (typeof item.cmd === "string") return item.cmd;
  return undefined;
}
