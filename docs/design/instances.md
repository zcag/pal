# Extension instances

Design spec, 2026-09-16. One extension, several configured copies: two Gmail accounts, two GitHub identities, two Slack workspaces, two Home Assistant homes. Each instance has its own settings, palettes, bar items, storage, frecency and deep links; the code and the manifest are shared. Status: proposed; nothing implemented.

## Goals and non-goals

- A user adds a second account in Settings (or by hand in the file) and gets a second set of palettes and bar items with their own settings, without the extension's author doing anything beyond `"multi": true` in `pal.json`.
- The extension's code never learns a new API to work: `settings.get()`, `storage`, `bar.update`, `push` keep meaning "me", where "me" is the instance.
- Nothing migrates: the tables that exist today are the default instance.
- One identity string, the **instance key**, used everywhere a name is used today (`Source.extension`, config tables, bar keys, links, storage, cache, frecency). No mapping layer.
- Non-goals: renaming a key after creation; instances of the `scripts` tier (its palettes come from a config file already); a per-instance directory of code; instances of an extension that did not declare `multi`.

## Config shape

The default instance is the existing table. A second one is a new table keyed `<name>@<instance>`:

```toml
[extensions.gmail]                     # the default instance, as today
signature = "Cagdas"

[instances."gmail@work"]               # the instance exists because this table does (empty is fine)
title = "Work"                         # the display name; default: the suffix, capitalised
tint = "amber"                         # one of the twelve brand colours; default: picked from the suffix
badge = "W"                            # 1 or 2 characters on the tile's corner; default: the title's first letter
enabled = true                         # false parks it: not loaded, rows gone, settings kept

[instances.gmail]                      # optional: name the default once a second exists
title = "Personal"

[extensions."gmail@work"]              # declared settings; inherits [extensions.gmail], except secrets
token = "keychain:pal/gmail@work-token"

[palettes."gmail@work-inbox"]          # per-palette keys, per instance (hotkey, alias, icon, enabled, tier)
hotkey = "ctrl+alt+w"
settings.columns = 2                   # declared palette settings inherit [palettes.gmail-inbox].settings

[bar.items."gmail@work/unread"]        # bar items, per instance
order = 30
```

**Why `[extensions."gmail@work"]` and not `[extensions.gmail.instances.work]`.**

1. One identity everywhere. `Source { extension, palette }` is the key of the index, the registry, frecency (`Key::from_source`), the cache file (`index/<extension>/<palette>.json`), the bar registry (`<extension>/<id>`), the deep link grammar (`open/<extension>/<palette>`) and the storage file. With the key spelled `gmail@work` all of those work unchanged (`registry.rs:160`, `cache.rs:58`, `bar/mod.rs:253`, `deeplink.rs:225`). A nested table would need a second identity and a translation at every boundary.
2. `Config.extensions` is `BTreeMap<String, toml::Table>` (`core/src/config/mod.rs:56`); the nested form would have to reserve the word `instances` inside every extension's own settings table, where undeclared keys pass through by design (`overlay`, `mod.rs:637`). An extension declaring a setting called `instances` would silently break. `@` cannot be a declared setting id.
3. The quoted key has precedent: `[bar.items."github/notifications"]`. The Settings window already quotes keys that need it (`seg`, `app/src/Settings.tsx:59`) and `edit.rs` handles quoted paths (`set_quoted_key_and_json_values`).

Trade-off accepted: the key needs quotes in TOML.

**`[instances]` is a pal table, like `[palettes]` and `[bar.items]`.** The instance's own identity (title, tint, badge, enabled) does not live inside `[extensions."gmail@work"]`, for the same reason as point 2: that table is the extension's namespace. `Config.instances: BTreeMap<String, Instance>` next to `palettes` and `bar` (`mod.rs:47-60`), with `extra` and `unknown_keys` like the others (`mod.rs:600`).

**Key grammar.** `<name>@<instance>`; `<name>` is a manifest name; `<instance>` is `[a-z0-9][a-z0-9_-]{0,31}`; exactly one `@`; `default` is refused as a suffix (the default instance is the bare name). `pal_core::config::instance::{split, name_of, is_key}` as pure helpers, unit-tested. A `[instances."x@y"]` whose `x` is not a loaded `multi` extension is a config warning (`x does not support instances`, shown in the diagnostics strip and the Overview) and is not loaded.

**Settings resolution** (`Config::extension_settings`, `mod.rs:570`): `defaults <- [extensions.gmail] <- [extensions."gmail@work"]`, each layer one level deep, a set key replacing whole. The middle layer skips settings declared `kind: "secret"` and settings declared `"scope": "instance"` (new optional `SettingSpec` field, `protocol.ts:656`): a token or a Home Assistant `url` identifies the account and is never inherited. `palette_settings` does the same over `[palettes.gmail-inbox].settings <- [palettes."gmail@work-inbox"].settings`. The pal-provided palette keys (`enabled alias hotkey icon tier item_hotkeys`) never inherit: a hotkey cannot be shared, an alias or icon is what tells the two apart. `extension_settings_resolved` (`mod.rs:585`) resolves secrets on the final table, so `keychain:pal/gmail@work-token` is looked up per instance. The default instance is unaffected (its middle layer is itself).

**Palette id.** Today: the extension's name when the palette is named like it, else `<extension>-<palette>` (`registry.rs:160`). With instances the rule reads: the instance key when the palette is named like the extension's *name*, else `<key>-<palette>`. So `gmail@work` for a `gmail` palette of `gmail@work`, `gmail@work-inbox` for `inbox`. The comparison uses `name_of(source.extension)`, one line. This keeps one id rule for `[palettes.*]` rather than introducing a `/` there (the `/` form stays the link's and the bar's, which are already `ext/id`).

## Identity

- **Key**: `gmail@work`. Fixed at creation; it sits in file paths, frecency and links. Settings offers Rename (the title), never re-keying; that is remove and add.
- **Title**: `[instances.<key>] title`, default the suffix capitalised ("Work"). The default instance has no title until the user names it; the UI then shows "Gmail (Personal)".
- **Tile**: the manifest's tile with `bg` replaced by the instance's `tint` and a `badge` letter in the bottom-right corner. `Tile` gains `badge?: string` (`sdk/src/icon.ts:24`, drawn by `app/src/ui/Icon.tsx`; `checkIcon` allows 1 to 2 characters). The default instance keeps the plain tile even when others exist, so the familiar one does not change under the user; the tint default for a new instance is chosen from `TILE_COLORS` by hashing the suffix, skipping the extension's own colour.
- **Palette titles**: with two or more instances of an extension, every palette title gets ` (<instance title>)` appended, unless the manifest's `palettes.<key>.title` contains `{instance}`, which is substituted instead (`"title": "{instance} Inbox"` gives "Work Inbox"). With one instance `{instance}` and one surrounding pair of parentheses or a flanking space are stripped, so "Inbox ({instance})" is "Inbox". Done once in the host where the manifest's title is merged over the code's (`paletteMeta`, `sdk/src/manifest.ts:53`), so the root section, the crumb, the Settings rows, the palette row and the bar popover title all read the same string with no further work. The palette row's subtitle stays the extension title ("Gmail"); its keywords gain the instance title and suffix (`palette_row`, `registry.rs:194`), so `work inbox` finds it.
- **Bar**: the strip is not marked (a letter in a 36 px template glyph is unreadable, and colour on the strip means state). The tooltip gets " (Work)" appended by the core, the popover's title bar shows the instance title, and `BarCtx` carries `instance` so an item can write it into `title` itself. Settings > Bar rows read "Gmail (Work) › Unread".

## The host

Three options for running two instances of one module:

| model | isolation of module state | cost per instance (measured) | core changes |
| --- | --- | --- | --- |
| one module, `import(entry?i=work)` | none: `api.ts`, `data.ts` are cached once; `github/api.ts:38 cachedToken`, `slack/api.ts:39 creds`, `slack/data.ts:76 dirs` would be shared | 0 | none |
| one process, a Bun `Worker` per instance | full: own global, own module registry, own SDK slot | 0.3 to 0.8 ms and 2.8 MB bare; 2.6 to 2.9 ms and ~5.7 MB with `github` imported; 6.5 ms with `slack`; 1.7 ms with `home-assistant` | none: still one child, one stdio |
| one `pal-bun` process per instance | full plus crash isolation | 8 ms spawn to exit and 14 MB for a bare `bun -e`, before the host's own bootstrap (`host/ready` is ~236 ms after spawn today); one `Host` reader task, id space, respawn, stop and `linkApi` per child | large: `host.rs` becomes a pool, the bridge routes by child |

Measured on hornet, Bun 1.4.2, with `bun -e` and blob-URL workers importing the real bundled extensions with a stub runtime bound (no files written). Importing `github` on the main thread costs 3.1 ms and 6.5 MB, so a worker adds under 1 ms and about 3 MB over the module itself.

**Recommendation: one process, one Bun Worker per instance of a `multi` extension.** The SDK already reaches the host through a per-global slot (`sdk/src/runtime.ts:31`, `bind`), so a worker binds its own runtime whose `caller()` answers the instance key without the stack walk (`host/src/settings.ts:28`); `settings.get()`, `storage`, `bar.update` and `push` then mean the instance for free. Module-level caches in submodules are isolated because the worker has its own module registry. A worker that hangs can be `terminate()`d, which is better than today's inline hang. Rejected: the query-string re-import (state leaks through submodules; the same reason hot reload leaves the old module resident) and a process per instance (the Rust `Host` is built around one child; the win, crash isolation, is not worth a pool).

**Rule: every instance of a `multi` extension runs in a worker, the default too, even when it is alone.** Symmetric, tested from day one, and "Add another account" changes nothing about the one that works. Non-`multi` extensions stay inline as today. Cost for the three bundled candidates: about 18 MB and 12 ms at startup. A later knob could keep a lone instance inline; not now.

**Mechanics** (`host/src/host.ts`, new `host/src/worker.ts`, new `host/src/instances.ts`):

- `reload(name)` (`host.ts:115`) reads the manifest; when `manifest.multi`, it asks `core/instances.get { extension: name }` for `[{ key, title, tint, badge, enabled }]` (the default first), else the list is `[{ key: name }]`. For each enabled key it spawns `new Worker(worker.ts)` and posts `{ init: { key, name, entry, manifest, settings } }` where `settings` is `core/settings.get { extension: key, manifest }` (`settings.rs:277`, unchanged, the key rides as `extension`).
- `worker.ts` is a mini host: binds the SDK with `call` forwarding `{ id, method, params }` to the main thread and awaiting the reply, `caller` returning `{ extension: key, palette }` from an `AsyncLocalStorage`, `resolved`/`subscribe` over its own table; imports the entry with `?t=`, runs `checkPalettes` and `checkLinks`, applies the title rule and the tinted tile, answers `list pick view detail inline fallback suggest link bar/*` messages inside `context.run`, runs `dispose()` on `stop`.
- The main thread keeps `instances: Map<key, Inline | WorkerInstance>`; `extension(name)` (`host.ts:323`) becomes `instance(key)`; every method in `methods` (`host.ts:380`) routes by `params.extension`. `sections()` (`host.ts:362`) asks inline palettes as today and each worker once for its sections, same `ROOT_TIMEOUT_MS`. Pending replies per worker are rejected on terminate.
- `extension/loaded` carries `extension: key, name, instance: { key, title, tint, badge, isDefault }` plus the rest; `extension/removed { extension: key }`; `hello` and `host/ready known` list keys, so `cache::prune` (`index.rs:240`) keeps `index/gmail@work/`.
- A file change (`schedule`, `host.ts:251`) reloads every instance of the name. `settings/changed` (`host.ts:446`) routes each key to its worker's table. A new notification `instances/changed { extension: name }` from the core makes the host re-read the list, spawn what is new, stop what is gone, and re-announce.
- `push` and `BarMenu { palette, extension? }` from inside an instance: the host rewrites `extension === name` (or absent) to the key before the effect leaves (`checkEffect` wrapper), so code that names itself by manifest name lands on itself. `effects.rs:206` then sees the key.
- SDK: `instance()` in `api.ts` answering `{ key, name, title, isDefault }`; `BarCtx.instance` (`protocol.ts:595`); `Manifest.multi?: boolean` (`protocol.ts:717`); `SettingSpec.scope?: "instance"`.

## Storage, cache, frecency, secrets

- `storage`: the SDK sends the caller's key, so `<data dir>/pal/storage/gmail@work.json`. `pal_core::storage::valid_name` (`core/src/storage.rs:64`) gains `@` (once, not first or last); the same rule in `Store` name validation (`extensions.rs:224`) stays without `@`: an installed directory is never an instance key.
- Index cache: `cache::path` (`cache.rs:58`) already accepts `@`.
- Frecency: `Key { extension: "gmail@work", .. }`; a pick in Work never boosts Personal; the Frequent section dedupes by key.
- Secrets: the Settings page already builds `pal/<segments joined by ->` (`Settings.tsx:305`), so the work token is `pal/gmail@work-token`, a distinct keychain item. Never inherited.

## Deep links and the CLI

The instance key takes the `{extension}` part of every route (`deeplink.rs:208-275`): `pal://open/gmail@work/inbox`, `pal://run/gmail@work/inbox/<id>`, `pal://form/...`, `pal://bar/gmail@work/unread`, and the extension route form `pal://gmail@work/<route>`. So "`pal://gmail@work/inbox`" in the request is spelled `pal://open/gmail@work/inbox` (bare `<ext>/<x>` is a declared route). `name_ok` (`deeplink.rs:202`) accepts one `@`. pal's parser splits on `/` itself (`parse`, `deeplink.rs:315`), so `@` in the first segment is never read as userinfo; `%40` decodes too. `Confirm::asks` (`mod.rs:274`) trusts by name (`["gmail"]` covers every instance) or by key. Copy deep link (`app/src/links.ts`) needs nothing: it spells the source's `extension`.

CLI: every verb that takes `<ext>` takes a key: `pal open gmail@work/inbox`, `pal bar click gmail@work/unread`, `pal bar list` prints keys. Phase 3 adds `pal instance list|add <name> <suffix> [--title T]|remove <key>` as link twins (`pal://instance/add/gmail/work?title=Work`, `pal://instance/remove/gmail@work`), file edits only, behind the confirm card like `install`.

## The store

`"multi": true` at the top level of `pal.json`, next to `platforms`. Without it Settings shows no "Add another" and a hand-written `[instances."x@y"]` is a warning. STORE-FIELDS.md: a `multi` row (Shown: "Several accounts" in the facts card and the hero line; a chip `/extensions?multi=1`; the API adds `multi`). `sdk/src/manifest.ts` `checkPalettes` warns when a title uses `{instance}` in a non-multi manifest.

## Settings UI

- **Extensions page** (`SettingsExtensions.tsx`): the left list stays one row per extension name (`Settings.tsx:279` dedupes by `name`, `SettingsExtension` gains `key` and `instances[]`). A `multi` extension's pane gets an **Instances** section above Settings: one row per instance (badged tile, title, `code` key, "default" tag, on/off switch, Rename, Remove; the default has no Remove) and "Add another account" opening an inline form (title, suffix auto-slugged and validated live, tint picker); Create writes `[instances."gmail@work"]` and selects it. The **Settings** section (`SettingsExtensions.tsx:206`) becomes per instance: a segmented control of instances; each field shows the effective value; an inherited one carries a muted "from Gmail (Personal)" note; `writeDeclared` (`Settings.tsx:301`) compares against the inherited effective value rather than `spec.default` for a non-default instance, so an equal value leaves the file. Secrets and `scope: instance` fields show empty with "set for this instance" and are what `needsSetup` (`SettingsTypes.ts:270`) flags, per instance.
- **Palettes page** (`SettingsPalettes.tsx:55`, `:92`): groups are per instance key (the `View.extensions` entry per key gives this for free); the header reads "Gmail (Work)" with the badged tile; rows "Inbox (Work)".
- **Bar page** (`SettingsBar.tsx`): rows per key already; `extTitle` becomes the instance's.
- **Overview**: needs-setup rows per instance ("Gmail (Work): token").
- Search anchors: `extensions:gmail@work:token`, `palettes:gmail@work-inbox`.
- Remove instance = `instances_remove` command (`settings.rs`): unsets `[instances.<key>]`, `[extensions.<key>]`, every `[palettes."<key>*"]` and `[bar.items."<key>/*"]`, deletes `storage/<key>.json` and `index/<key>/`, forgets frecency for the key (`Frecency::forget_source`, new), keychain items stay (as today, documented).

## Migration

None. `[instances]` absent means one instance per extension, the existing `[extensions.<name>]` table is it, frecency, cache and storage keep their bare-name keys. The schema gains `instances`; an older pal reads the key as unknown and warns.

## Edge cases

- **Instance removed while its palette is open**: `apply_config` diffs instance keys, notifies the host, the worker is disposed and terminated, `extension/removed` drops sources and bar items (`index.rs:486`). Today an open level on a vanished source keeps its rows until a pick fails; add a small Launcher rule: on `pal://index`, a level whose source is gone from `sources()` pops to the root with a toast.
- **Secrets per instance**: above. An instance with no token behaves as the extension does with none (GitHub falls to `gh auth token`, so Personal and Work would be the same account until Work's token is set; the Overview says so).
- **Extension updates** apply to all instances: one directory, one version; the watcher reloads every worker; `pal update gmail` restarts the host as today.
- **Scripts tier** unaffected: not `multi`; its palettes and ids (`scripts-otp`) are as before.
- **Disabled instance** (`enabled = false`): no worker, no rows, config kept; like a palette's `enabled`.
- **The default instance alone**: identical to today, plus running in a worker for `multi` extensions.
- **sketchybar names** `pal.gmail@work.unread`: `@` is not a sketchybar operator, but verify on hornet in phase 2; fallback is a per-key name map in `sketchybar.rs:39` (`@` to `_`), kept private to that renderer.
- **`fromStack`** (`host/src/settings.ts:28`) would answer the directory name, not the key; never used in a worker (the worker's `caller` knows its key).
- **`hello` after a host restart** lists keys; the Settings registry (`settings.rs:221`) keys `Ext` by `extension` (the key) and adds `name`.

## Bundled extensions

| extension | `multi` | why |
| --- | --- | --- |
| gmail (when it exists) | yes | two accounts, the driving case |
| github | yes | two accounts: `token` per instance, `org` inherits |
| slack | yes | workspaces: `workspace` is `scope: instance`, token mode per instance; resolves the "several workspaces for Status and Search" note in decisions.md |
| home-assistant | yes | two homes: `url` is `scope: instance`, token per instance |
| calendar | no | already handles accounts internally (`accounts` list) |
| ssh, and the rest | no | one machine, one thing |

Later candidates, not now: docker (contexts), onepassword (accounts).

## Phases

**Phase 0, core config (pure, tested first).** `core/src/config/mod.rs`: `Instance` struct, `Config.instances`, `instance::{split,name_of,is_key}`, `instance_keys(name, multi)`, inheritance in `extension_settings` (`:570`) and `palette_settings` (`:575`) taking `specs` to skip secrets and `scope: instance`, `unknown_keys` (`:600`), schema regen (`cargo run -p pal-core --example schema`). `registry::palette_id` (`registry.rs:160`) by `name_of`. `storage.rs:64` `valid_name`. Tests: `instance_keys_default_first_and_disabled_skipped`, `inheritance_skips_secrets_and_instance_scope`, `palette_id_of_an_instance`, `unknown_keys_under_instances`, `storage_accepts_one_at_sign`.

**Phase 1, host.** `host/src/worker.ts`, `host/src/instances.ts`, `host.ts` routing (`:115`, `:323`, `:362`, `:380`, `:446`), `sdk/src/manifest.ts:53` title rule and tinted tile, `sdk/src/icon.ts:24` badge, `sdk/src/protocol.ts` (`multi`, `scope`, `BarCtx.instance`, loaded payload), `sdk/src/api.ts` `instance()`, the `push` rewrite. Tests in `host/test/instances.test.ts` with a fixture multi extension whose submodule holds a counter: two instances count separately; `settings.get()` per key; `storage` calls carry the key; `push` without extension lands on the key; `dispose` runs on remove; a hanging instance is terminated without hurting the other; title rule cases; `hello`/`known` list keys.

**Phase 2, core app.** `settings.rs`: `Ext.name` + key (`:40`, `:221`), `resolved` by key (`:259`), `changed_extensions` sees a `[extensions.gmail]` edit as a change to `gmail@work` (`:295`), `instances` diff in `on_reload` (`:168`) -> `host.notify("instances/changed")`, `core/instances.get` in the bridge, `instances_remove` command. `index.rs` `on_notification` (`:195`) reads `name`/`instance`. `deeplink.rs:202` `name_ok`, `mod.rs:274` `Confirm::asks`. `bar/mod.rs` tooltip suffix, `BarCtx.instance` in `render` params (`:509`). `app/src/ui/Icon.tsx` badge. Launcher pop on a gone source. Tests: `deeplink` route examples with keys, `confirm_trusts_by_name_or_key`, `changed_extensions_follow_inheritance`, `instances_remove_unsets_every_table`, bar `keys_and_targets` with `@`.

**Phase 3, Settings UI and docs.** `SettingsExtensions.tsx` Instances section and per-instance settings, `SettingsPalettes.tsx` grouping, `SettingsBar.tsx`, `SettingsTypes.ts`, `Settings.tsx` (`:279`, `:301`, `:341`). Docs: `docs/config.md` (`[instances]`, inheritance), `docs/extensions.md` (`multi`, `{instance}`, `scope`, `instance()`), `docs/links.md`, `docs/cli.md`, `pal-site/STORE-FIELDS.md`. Manifests: `github`, `slack`, `home-assistant` gain `multi` and `scope: instance` on `workspace`/`url`. Vitest: `writeDeclared` against the inherited value; the add form's slug validation. Verify on hornet: two GitHub instances, sketchybar names, `pal://open/github@work/prs`.
