// The host's side of `@zcag/pal`: `bindSdk` hands the SDK (sdk/src, the
// package an extension imports) this host's bridge and settings table, so
// its `settings`, `storage`, `clipboard`, ... reach the core. Once, before
// any extension is imported; the in-process tests call it too.
import { resolve } from "node:path";
import { bind } from "../../sdk/src/runtime.ts";
import { call } from "./bridge.ts";
import { caller, resolved, subscribe } from "./settings.ts";

/** The SDK's directory: `sdk/` next to `host/`, in the repo and in the staged resource tree alike. */
export const SDK = resolve(import.meta.dir, "../../sdk");

export const bindSdk = () => bind({ call, caller, resolved, subscribe });
