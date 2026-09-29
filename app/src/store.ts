/**
 * Extension distribution as the webviews see it: the core's `store_*`
 * commands, typed, and the `pal://store` event that carries the whole
 * `StoreState` whenever it changes (a refresh, an install, a load result,
 * a config change). The shapes mirror `StoreState` and friends in
 * sdk/src/api.ts, which mirror the core's (pal_core::updates, registry,
 * manage). Nothing here compares builds: the core's one check answers.
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Build = { hash: string; seq: number; protocol: number; commit: string; url: string; manifest: string; size?: number; sig: string; yanked?: boolean };
export type BuildInfo = { hash: string; seq: number; protocol: number; commit: string };
export type Screenshot = { url: string; caption?: string } | string;
export type Listing = {
  title: string; description: string; tagline: string; category: string; keywords: string[]; icon: unknown; author: string;
  platforms?: string[] | null; play: boolean; palettes: { id: string; title: string; kind: string }[]; screenshots: Screenshot[]; requires: string[]; suggests: string[];
};
export type Origin = "bundled" | "store" | "local";
/** `pal_core::updates::Status`, its state flattened under `state`. */
export type Status = { name: string; origin: Origin; registry?: string | null; installed?: BuildInfo | null; auto_update: boolean } & (
  | { state: "up_to_date" }
  | { state: "update"; to: Build }
  | { state: "needs_newer_pal"; protocol: number }
  | { state: "yanked"; replacement?: Build | null }
  | { state: "no_longer_listed"; why: string }
  | { state: "unchecked" }
  | { state: "source" }
  | { state: "local" }
);
export type Channel = "stable" | "edge";
/** `last_checked` and `last_ok` are unix seconds. */
export type RegistryStatus = { name: string; url: string; channel: Channel; auto_update: boolean; key: string; count: number; generated_at?: string | null; last_checked?: number | null; last_ok?: number | null; last_error?: string | null; ours: boolean };
export type Available = { name: string; registry: string; listing: Listing; installed: boolean; bundled: boolean; installable: boolean; blocked?: string; build?: BuildInfo };
export type Pending = { name: string; registry: string; error?: string; since: number };
export type RolledBack = { name: string; hash: string; error: string; at: number };
export type LeftOverKind = "config" | "hotkey" | "bar" | "alias" | "state" | "fallback" | "sidebar";
export type LeftOver = { name: string; refs: { kind: LeftOverKind; what: string }[] };
export type StoreState = {
  auto_update: boolean; usage: boolean;
  registries: RegistryStatus[]; statuses: Status[]; available: Available[];
  pending: Pending[]; rolled_back: RolledBack[]; unlisted: string[];
  disabled: string[]; leftovers: LeftOver[]; busy: string[];
};
export type OpResult = { name: string; ok: boolean; loaded?: boolean; error?: string };
export type Preview = { name: string; url: string; count: number; key: string; key_id: string };
export type From = "store" | "settings" | "search" | "games" | "welcome" | "web" | "deeplink" | "migration" | "reconcile" | "auto" | "cli";

/** What a page shows before the core answered, and what a partial answer is filled out to: nothing known, nothing claimed. */
export const EMPTY_STORE: StoreState = { auto_update: true, usage: true, registries: [], statuses: [], available: [], pending: [], rolled_back: [], unlisted: [], disabled: [], leftovers: [], busy: [] };

/** A payload with fields missing (an older core, a partial event) read as the empty state's. */
export const storeOf = (s: Partial<StoreState> | null | undefined): StoreState => ({ ...EMPTY_STORE, ...(s ?? {}) });

export const STORE_EVENT = "pal://store";

/** The core's commands, one wrapper each; every one rejects with the core's message. */
export const store = {
  state: () => invoke<StoreState>("store_state").then(storeOf),
  refresh: () => invoke<StoreState>("store_refresh").then(storeOf),
  install: (name: string, registry: string | null, from: From) => invoke<OpResult>("store_install", { name, registry, from }),
  update: (names: string[], from: From) => invoke<OpResult[]>("store_update", { names, from }),
  remove: (name: string, forget: boolean) => invoke<OpResult>("store_remove", { name, forget }),
  setDisabled: (name: string, disabled: boolean) => invoke<void>("store_set_disabled", { name, disabled }),
  registryPreview: (url: string, key: string | null) => invoke<Preview>("store_registry_preview", { url, key }),
  registryAdd: (url: string, key: string) => invoke<void>("store_registry_add", { url, key }),
  registryRemove: (name: string) => invoke<void>("store_registry_remove", { name }),
  registrySet: (name: string, autoUpdate: boolean | null, channel: Channel | null) => invoke<void>("store_registry_set", { name, autoUpdate, channel }),
  forgetLeftover: (name: string) => invoke<void>("store_forget_leftover", { name }),
  /** The Store palette in the panel. */
  openStore: () => invoke<void>("settings_open_store"),
  /** A palette of `extension` opened (the usage counts; the core dedupes per show). */
  opened: (extension: string) => invoke<void>("usage_opened", { extension }),
};

/** An operation's result as a thrown error when it did not go through, so a caller can `await` it like any command. */
export function ok(r: OpResult): OpResult {
  if (!r.ok) throw new Error(r.error || `${r.name} did not go through`);
  if (r.loaded === false) throw new Error(r.error ? `${r.name} is installed but failed to load: ${r.error}` : `${r.name} is installed but failed to load`);
  return r;
}

/**
 * The store's state, kept live: read once, then every `pal://store`
 * replaces it. `refresh` asks the core to fetch every registry now (the
 * Extensions page does on open); its answer lands through the event too.
 * `loaded` is false until the first answer, so a page can tell "nothing
 * yet" from "nothing".
 */
export function useStore(): { state: StoreState; loaded: boolean; error?: string; refresh: () => Promise<void> } {
  const [state, setState] = useState<StoreState>(EMPTY_STORE);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const take = useCallback((s: StoreState) => { setState(s); setLoaded(true); setError(undefined); }, []);
  useEffect(() => {
    let live = true;
    store.state().then((s) => { if (live) take(s); }, (e) => { if (live) setError(String(e)); });
    const un = listen<StoreState>(STORE_EVENT, (e) => { if (live) take(storeOf(e.payload)); });
    return () => { live = false; un.then((f) => f()); };
  }, [take]);
  const refresh = useCallback(() => store.refresh().then(take, (e) => setError(String(e))), [take]);
  return { state, loaded, error, refresh };
}
