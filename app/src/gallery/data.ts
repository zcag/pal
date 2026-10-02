/** Hand-written items exercising every field, plus a fixture sample. */
import { toItem, type Raw } from "../fixtures";
import { iconOf as iconFromWire } from "../items";
import type { Action, FormField, Item } from "../ui/types";

const h = 3600e3, d = 24 * h;
const now = Date.now();

/** Self-contained image icon: a coloured tile with a letter. */
export const svgIcon = (bg: string, letter: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><text x="32" y="42" font-family="system-ui" font-size="32" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`)}`;

export const actions: Action[] = [
  { id: "open", title: "Open in Browser", icon: { kind: "glyph", value: "↗" } },
  { id: "copy", title: "Copy URL", icon: { kind: "glyph", value: "⎘" }, shortcut: "cmd+c" },
  { id: "copy-md", title: "Copy as Markdown Link", shortcut: "cmd+shift+c", section: "Copy" },
  { id: "copy-title", title: "Copy Title", shortcut: "cmd+alt+c", section: "Copy" },
  { id: "pin", title: "Pin to Top", shortcut: "cmd+p", section: "Organise" },
  { id: "rename", title: "Rename…", shortcut: "cmd+r", section: "Organise" },
  { id: "delete", title: "Delete Bookmark", shortcut: "ctrl+x", style: "destructive", section: "Organise" },
];

export const deploy: Item = {
  id: "deploy-tela",
  name: "Deploy tela",
  subtitle: "Ship main to production",
  icon: { kind: "glyph", value: "󰚰", color: "#8b7cf6" },
  palette: "cmds",
  section: "Work",
  accessories: [{ tag: "prod", color: "red" }, { date: now - 3 * h }],
  actions: [
    { id: "run", title: "Run", icon: { kind: "glyph", value: "▶" } },
    { id: "dry", title: "Dry Run", shortcut: "cmd+d" },
    { id: "logs", title: "Open Last Deploy Log", shortcut: "cmd+l", section: "Inspect" },
    { id: "rollback", title: "Roll Back", shortcut: "cmd+shift+r", style: "destructive", section: "Danger" },
  ],
  detail: {
    markdown: `# Deploy tela

Builds the \`main\` branch, runs the migration set and swaps the **blue/green** target on marko.

## Steps

1. \`git fetch\` and verify the tag
2. Build the image, push to the registry
3. Run migrations against the replica first
4. Flip the upstream in Caddy

> Rolling back re-points the upstream; migrations are forward-only.

| Env | Host | Last |
| --- | --- | --- |
| prod | marko | 3h ago |
| staging | archer | 2d ago |

See the [runbook](https://tela.lan/runbook) for the manual path.

\`\`\`sh
tela deploy --env prod --tag v1.4.2
\`\`\`
`,
    metadata: [
      { label: "Environment", value: "prod" },
      { label: "Last run", value: "3h ago" },
      { label: "Status", tags: [{ text: "healthy", color: "green" }, { text: "v1.4.2" }] },
      { label: "Runbook", link: { text: "tela.lan/runbook", href: "https://tela.lan/runbook" } },
    ],
  },
};

export const raycastDocs: Item = {
  id: "bm-raycast",
  name: "Raycast API reference",
  subtitle: "developers.raycast.com",
  icon: { kind: "image", src: svgIcon("#ff6363", "R"), mask: "rounded" },
  palette: "bookmarks",
  section: "Reference",
  keywords: ["api", "extension"],
  accessories: [{ text: "Bookmark" }, { date: now - 2 * d }],
  actions,
  detail: {
    markdown: "# Raycast API\n\nComponent set reference used to keep our tree close enough for a shim.\n\n- List, Grid, Detail, Form\n- ActionPanel, Action\n- Toast, HUD, Alert\n",
    metadata: [
      { label: "Added", value: "2 days ago" },
      { label: "Tags", tags: [{ text: "reference" }, { text: "raycast", color: "#ff6363" }] },
    ],
  },
};

export const person: Item = {
  id: "person-ada",
  name: "Ada Lovelace",
  subtitle: "ada@example.org",
  icon: { kind: "image", src: svgIcon("#3b82f6", "A"), mask: "circle" },
  palette: "contacts",
  section: "People",
  accessories: [{ tag: "family", color: "teal" }, { date: now - 20 * 60e3 }],
  actions: [
    { id: "mail", title: "Compose Email" },
    { id: "call", title: "Call", shortcut: "cmd+enter" },
  ],
  detail: { metadata: [{ label: "Email", value: "ada@example.org" }, { label: "Phone", value: "+44 20 7946 0958" }, { label: "Birthday", value: "10 December" }] },
};

export const longTitle: Item = {
  id: "long",
  name: "A very long title that should be truncated with an ellipsis rather than wrapping onto a second line inside the row",
  subtitle: "and a subtitle that is also fairly long and competes for the same horizontal space",
  icon: { kind: "emoji", value: "📚" },
  palette: "tabs",
  section: "Edge cases",
  accessories: [{ text: "42 min read" }, { tag: "queue" }],
};

export const noIcon: Item = { id: "noicon", name: "Item without an icon", subtitle: "Keeps its icon box so titles align", palette: "misc", section: "Edge cases" };

export const emojiRow: Item = { id: "sparkles", name: "sparkles", icon: { kind: "emoji", value: "✨" }, palette: "emoji", section: "Edge cases", accessories: [{ text: "U+2728" }], keywords: ["shine", "magic"] };

export const future: Item = { id: "future", name: "Dentist", subtitle: "Reminder", icon: { kind: "emoji", value: "🦷" }, palette: "calendar", section: "Edge cases", accessories: [{ date: now + 26 * h }] };

export const handWritten: Item[] = [deploy, raycastDocs, person, longTitle, noIcon, emojiRow, future];

export const formFields: FormField[] = [
  { kind: "text", id: "title", label: "Title", placeholder: "What is this bookmark called?", value: "Raycast API reference", required: true },
  { kind: "text", id: "url", label: "URL", placeholder: "https://", required: true, description: "Submit with this empty to see the required mark." },
  { kind: "password", id: "token", label: "Token", placeholder: "Only for private pages" },
  { kind: "select", id: "folder", label: "Folder", options: [{ id: "ref", title: "Reference" }, { id: "daily", title: "Daily" }, { id: "infra", title: "Infra" }] },
  { kind: "textarea", id: "notes", label: "Notes", placeholder: "Anything worth remembering (cmd+enter submits from here)" },
  { kind: "checkbox", id: "pin", label: "Pinned", text: "Show at the top of the folder", value: true },
];

/** A spread of fixture rows: a few from each palette, real names and icons. */
export function sample(raws: Raw[], per = 12): Item[] {
  const seen = new Map<string, number>();
  return raws.filter((r) => {
    const n = seen.get(r.palette) ?? 0;
    seen.set(r.palette, n + 1);
    return n < per;
  }).map(toItem);
}

export const markdownOnly = {
  markdown: `## Markdown only

Paragraphs, *emphasis*, **strong**, ~~struck~~, \`code\`, and a [link](https://example.org).

- one
- two
  - nested

---

![tile](${svgIcon("#8b7cf6", "P")})
`,
};

/* Settings: four extensions as installed, their palettes as configured in config.toml. */
import { lookDefaults, type BarConfig, type BarItem, type Diagnostic, type GeneralConfig, type HotkeyStatus, type PermissionsStatus, type SettingSpec, type SettingsExtension } from "../ui/SettingsTypes";
import type { Listing, StoreState } from "../store";

export const settingsGeneral: GeneralConfig = { hotkeys: ["ctrl+space"], theme: "system", design: "ink", launchAtLogin: true, menuBarIcon: true, position: "top", backspaceBack: true, checkUpdates: true, autoUpdate: true, usage: true };
/** A stock Mac asking for ⌘Space: Spotlight holds it, the guidance shows. */
/** Every entry's fate as the gallery's General page fakes it: ⌘Space is Spotlight's, anything else registers. */
export const settingsHotkeyStatus = (hotkeys: string[]): HotkeyStatus => {
  const each = hotkeys.map((wanted) => (wanted === "cmd+space" ? { wanted, registered: false, error: "Spotlight takes this key first", spotlight: "cmd+space" } : { wanted, registered: true }));
  return { hotkeys: each, registered: !each.length || each.some((h) => h.registered) };
};
export const settingsPermissions: PermissionsStatus = { accessibility: false };

export const settingsFile = { path: "~/.config/pal/config.toml", changed: now - 2 * 60e3 };

/** A build of the fixture registry: `seq` days ago, unix seconds. */
const build = (hash: string, daysAgo: number) => ({ hash, seq: Math.floor((now - daysAgo * d) / 1000), protocol: 3, commit: hash.slice(0, 12), url: `https://pal.cagdas.io/registry/pkg/x/${hash}.tar.gz`, manifest: "", sig: "" });
const info = (hash: string, daysAgo: number) => { const { hash: h, seq, protocol, commit } = build(hash, daysAgo); return { hash: h, seq, protocol, commit }; };
const listing = (title: string, tagline: string, category: string, glyph: string, bg: string, palettes: string[] = [title], extra: Partial<Listing> = {}): Listing => ({
  title, tagline, description: `${tagline}.`, features: [], category, keywords: [], icon: { tile: { glyph, bg } }, author: "pal", platforms: null, play: category === "fun",
  palettes: palettes.map((p) => ({ id: p.toLowerCase(), title: p, kind: category === "fun" ? "view" : "list" })), screenshots: [], requires: [], suggests: [], ...extra,
});

/**
 * The store as Settings › Extensions reads it, with every kind of Needs you
 * row: an update that waits (auto-update off for pal's registry here), a
 * pulled build with its replacement, a rolled-back update, one that needs a
 * newer pal, one no longer listed, a pending install, a registry that
 * failed, config left over from Gmail, a store folder not in the list, and
 * Timer turned off while its hotkey and bar item still point at it.
 */
export const settingsStore: StoreState = {
  auto_update: false,
  usage: true,
  registries: [
    { name: "pal", url: "https://pal.cagdas.io/registry/index.json", channel: "stable", auto_update: false, key: "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3", count: 47, generated_at: "2026-09-29T12:00:00Z", last_checked: Math.floor((now - 5 * 60e3) / 1000), last_ok: Math.floor((now - 5 * 60e3) / 1000), ours: true },
    { name: "acme", url: "https://acme.github.io/pal/index.json", channel: "edge", auto_update: true, key: "RWTacmeacmeacmeacmeacmeacmeacmeacmeacmeacmeacmeacme", count: 3, last_checked: Math.floor((now - 3 * 60e3) / 1000), last_ok: Math.floor((now - 2 * h) / 1000), last_error: "unreachable: connection refused", ours: false },
  ],
  statuses: [
    { name: "apps", origin: "bundled", registry: "pal", installed: info("a1b2c3d4e5f6a7b8", 12), auto_update: false, state: "up_to_date" },
    { name: "bookmarks", origin: "store", registry: "acme", installed: info("b0b0b0b0b0b0b0b0", 20), auto_update: true, state: "yanked", replacement: build("b1b1b1b1b1b1b1b1", 1) },
    { name: "github", origin: "store", registry: "pal", installed: info("9f8e7d6c5b4a3928", 9), auto_update: false, state: "update", to: build("3c4d5e6f7a8b9c0d", 2) },
    { name: "clipboard", origin: "store", registry: "pal", installed: info("c1c1c1c1c1c1c1c1", 6), auto_update: false, state: "up_to_date" },
    { name: "weather", origin: "store", registry: "pal", installed: info("e1e1e1e1e1e1e1e1", 30), auto_update: false, state: "needs_newer_pal", protocol: 4 },
    { name: "hue", origin: "store", registry: "acme", installed: info("f1f1f1f1f1f1f1f1", 40), auto_update: true, state: "no_longer_listed", why: "acme no longer lists it" },
    { name: "stats", origin: "store", registry: "pal", installed: info("d1d1d1d1d1d1d1d1", 3), auto_update: false, state: "up_to_date" },
    { name: "timer", origin: "bundled", registry: "pal", installed: info("7171717171717171", 12), auto_update: false, state: "up_to_date" },
    { name: "tan", origin: "store", registry: null, installed: null, auto_update: false, state: "source" },
  ],
  available: [
    { name: "apps", registry: "pal", listing: listing("Applications", "Every app, launched by name", "system", "\u{f003b}", "slate"), installed: true, bundled: true, installable: true, build: info("a1b2c3d4e5f6a7b8", 12) },
    { name: "timer", registry: "pal", listing: listing("Timer", "Countdowns on the bar", "productivity", "\u{f0954}", "amber"), installed: true, bundled: true, installable: true, build: info("7171717171717171", 12) },
    { name: "github", registry: "pal", listing: listing("GitHub", "Pull requests, issues and repositories", "developer", "", "ink", ["Pull requests", "Issues", "Repositories"]), installed: true, bundled: false, installable: true, build: info("3c4d5e6f7a8b9c0d", 2) },
    { name: "weather", registry: "pal", listing: listing("Weather", "The forecast where you are", "reference", "\u{f0599}", "cyan"), installed: true, bundled: false, installable: false, blocked: "needs pal with protocol 4" },
    { name: "spotify", registry: "pal", listing: listing("Spotify", "What is playing, and search to play", "media", "\u{f04c7}", "green", ["Spotify", "Search Spotify"]), installed: false, bundled: false, installable: true, build: info("5p5p5p5p5p5p5p5p", 4) },
    { name: "gmail", registry: "pal", listing: listing("Gmail", "Your inbox, read and archived from the panel", "integration", "\u{f02ab}", "red", ["Inbox", "Search mail"]), installed: false, bundled: false, installable: true, build: info("6m6m6m6m6m6m6m6m", 8) },
    { name: "2048", registry: "pal", listing: listing("2048", "Slide the tiles, make 2048", "fun", "\u{f0b64}", "orange"), installed: false, bundled: false, installable: true, build: info("2048204820482048", 15) },
    { name: "wordle", registry: "pal", listing: listing("Wordle", "The daily five-letter word", "fun", "\u{f0b3a}", "green"), installed: false, bundled: false, installable: true, build: info("w0w0w0w0w0w0w0w0", 15) },
    { name: "docker", registry: "pal", listing: listing("Docker", "Containers and images: start, stop, logs", "developer", "\u{f0868}", "blue", ["Containers", "Images"]), installed: false, bundled: false, installable: true, build: info("d0d0d0d0d0d0d0d0", 22) },
    { name: "dpi", registry: "pal", listing: listing("DPI", "Display scaling in one keystroke", "system", "\u{f0379}", "teal"), installed: false, bundled: false, installable: false, blocked: "not for this platform" },
    { name: "todo", registry: "acme", listing: listing("Todo", "A plain list of things to do", "productivity", "\u{f0134}", "violet", ["Todo"], { author: "acme" }), installed: false, bundled: false, installable: true, build: info("7d7d7d7d7d7d7d7d", 5) },
  ],
  pending: [{ name: "spotify", registry: "pal", error: "offline: pal.cagdas.io is not reachable", since: Math.floor((now - 3 * h) / 1000) }],
  rolled_back: [{ name: "clipboard", hash: "c2c2c2c2c2c2c2c2", error: "TypeError: undefined is not an object (evaluating 'row.icon')", at: Math.floor((now - d) / 1000) }],
  unlisted: ["tan"],
  disabled: ["timer"],
  leftovers: [{ name: "gmail", refs: [{ kind: "hotkey", what: "palettes.gmail hotkey ctrl+alt+g" }, { kind: "bar", what: "bar.items.\"gmail/unread\"" }, { kind: "config", what: "[extensions.gmail]" }] }],
  busy: [],
};
const statusOf = (name: string) => settingsStore.statuses.find((s) => s.name === name);

/** The extensions only the Extensions page fixture adds (a failed load, one too new, one no longer listed, one turned off, a hand-made one): kept out of `settingsExtensions`, which other pages' tests count. */
export const storeExtensions: SettingsExtension[] = [
  { name: "weather", key: "weather", title: "Weather", description: "The forecast where you are.", icon: { kind: "tile", bg: "cyan", glyph: "\u{f0599}" }, version: "0.1.0", bundled: false, status: statusOf("weather"), settings: [], values: {}, loaded: true, palettes: [{ id: "weather", title: "Weather", settings: [], config: { enabled: true, settings: {} } }] },
  { name: "hue", key: "hue", title: "Hue", description: "Lights and scenes.", icon: { kind: "tile", bg: "amber", glyph: "\u{f0335}" }, version: "0.1.0", bundled: false, status: statusOf("hue"), settings: [], values: {}, loaded: true, palettes: [{ id: "hue", title: "Hue", settings: [], config: { enabled: true, settings: {} } }] },
  { name: "stats", key: "stats", title: "Stats", description: "CPU, memory and network at a glance.", icon: { kind: "tile", bg: "teal", glyph: "\u{f0128}" }, version: "0.1.0", bundled: false, status: statusOf("stats"), settings: [], values: {}, loaded: false, error: "SyntaxError: Unexpected token '}' at index.ts:41", palettes: [] },
  { name: "timer", key: "timer", title: "Timer", description: "Countdowns on the bar.", tagline: "Countdowns on the bar", icon: { kind: "tile", bg: "amber", glyph: "\u{f0954}" }, version: "0.1.0", bundled: true, status: statusOf("timer"), disabled: true, settings: [], values: {}, loaded: false, palettes: [] },
  { name: "tan", key: "tan", title: "tan", description: "A hand-made extension in the store folder.", icon: { kind: "tile", bg: "slate", glyph: "t" }, version: "", bundled: false, status: statusOf("tan"), settings: [], values: {}, loaded: true, palettes: [{ id: "tan", title: "tan", settings: [], config: { enabled: true, settings: {} } }] },
];
/** What the Timer's config still points at while it is off. */
export const storeReferences: Record<string, string[]> = { timer: ["the hotkey ctrl+alt+t", "the bar item timer/timer"] };

export const settingsExtensions: SettingsExtension[] = [
  {
    name: "apps",
    key: "apps",
    title: "Applications",
    description: "Installed apps and system settings panes, with their real icons.",
    icon: { kind: "tile", bg: "slate", glyph: "\u{f003b}" },
    version: "0.1.0",
    bundled: true,
    status: statusOf("apps"),
    installed: now - 30 * d,
    settings: [
      { kind: "list", id: "folders", label: "Extra folders", description: "Scanned in addition to /Applications and ~/Applications.", placeholder: "/path/to/apps", default: [] },
      { kind: "boolean", id: "prefpanes", label: "System settings", text: "List System Settings panes as apps", default: true },
    ],
    values: { folders: ["~/Applications/JetBrains Toolbox"], prefpanes: true },
    palettes: [
      { id: "apps", title: "Applications", description: "Everything that launches.", settings: [], config: { enabled: true, alias: undefined, hotkey: undefined, settings: {} } },
    ],
  },
  {
    name: "bookmarks",
    key: "bookmarks",
    title: "Browser",
    description: "Bookmarks and open tabs from the browser you use.",
    icon: { kind: "tile", bg: "orange", glyph: "\u{f00c0}" },
    version: "2.1.0",
    repo: "github.com/zcag/pal-browser",
    bundled: false,
    status: statusOf("bookmarks"),
    installed: now - 12 * d,
    settings: [
      { kind: "select", id: "browser", label: "Browser", options: [{ id: "chrome", title: "Google Chrome" }, { id: "firefox", title: "Firefox" }, { id: "safari", title: "Safari" }], default: "chrome" },
      { kind: "path", id: "bookmarks_file", label: "Bookmarks file", pick: "file", description: "Read directly; the browser does not need to be running.", default: "~/Library/Application Support/Google/Chrome/Default/Bookmarks" },
    ],
    values: { browser: "chrome" },
    palettes: [
      { id: "bookmarks", title: "Bookmarks", settings: [
        { kind: "select", id: "folder", label: "Folder", options: [{ id: "all", title: "All folders" }, { id: "bar", title: "Bookmarks bar only" }], default: "all" },
      ], config: { enabled: true, alias: "bm", hotkey: "cmd+shift+b", itemHotkeys: { "bm:docs": "ctrl+alt+d", "bm:mail": "ctrl+alt+m" }, settings: {} } },
      { id: "tabs", title: "Open tabs", settings: [], config: { enabled: false, alias: undefined, hotkey: undefined, settings: {} } },
    ],
  },
  // GitHub as a `multi` extension with two instances (docs/design/instances.md): the named default and a Work account whose token is not set yet.
  {
    name: "github",
    key: "github",
    multi: true,
    instance: { key: "github", title: "Personal", isDefault: true, enabled: true },
    title: "GitHub (Personal)",
    extTitle: "GitHub",
    description: "Pull requests, issues and repositories you can see with the token you give it.",
    icon: { kind: "tile", bg: "ink", glyph: "\uf408" },
    version: "1.4.2",
    bundled: false,
    status: statusOf("github"),
    repo: "github.com/zcag/pal-github",
    installed: now - 5 * d,
    settings: [
      { kind: "secret", id: "token", label: "Token", description: "A fine-grained personal access token with read access to the repositories you want listed.", placeholder: "github_pat_…" },
      { kind: "select", id: "org", label: "Organisation", description: "Repositories outside it are not listed.", options: [{ id: "zcag", title: "zcag" }, { id: "serpapi", title: "serpapi" }, { id: "all", title: "Everything the token can see" }], default: "all" },
      { kind: "boolean", id: "drafts", label: "Drafts", text: "Include draft pull requests", default: false },
    ],
    values: { token: "keychain:pal/github-token", org: "serpapi", drafts: true },
    palettes: [
      { id: "github-prs", title: "Pull requests (Personal)", description: "Open pull requests across the organisation, newest first.", settings: [
        { kind: "select", id: "state", label: "State", options: [{ id: "open", title: "Open" }, { id: "all", title: "Open and closed" }], default: "open" },
        { kind: "boolean", id: "mine", label: "Mine only", text: "Only pull requests I opened or review", default: false },
      ], config: { enabled: true, alias: "pr", hotkey: "ctrl+alt+p", settings: { mine: true } } },
      { id: "github-issues", title: "Issues (Personal)", settings: [], config: { enabled: true, alias: undefined, hotkey: undefined, settings: {} } },
      { id: "github-repos", title: "Repositories (Personal)", settings: [], config: { enabled: true, alias: "gh", hotkey: undefined, icon: "📦", settings: {} } },
    ],
  },
  {
    name: "github",
    key: "github@work",
    multi: true,
    instance: { key: "github@work", suffix: "work", title: "Work", tint: "violet", badge: "W", isDefault: false, enabled: true },
    title: "GitHub (Work)",
    extTitle: "GitHub",
    description: "Pull requests, issues and repositories you can see with the token you give it.",
    icon: { kind: "tile", bg: "violet", glyph: "\uf408", badge: "W" },
    version: "1.4.2",
    bundled: false,
    status: statusOf("github"),
    repo: "github.com/zcag/pal-github",
    installed: now - 5 * d,
    settings: [
      { kind: "secret", id: "token", label: "Token", description: "A fine-grained personal access token with read access to the repositories you want listed.", placeholder: "github_pat_…" },
      { kind: "select", id: "org", label: "Organisation", description: "Repositories outside it are not listed.", options: [{ id: "zcag", title: "zcag" }, { id: "serpapi", title: "serpapi" }, { id: "all", title: "Everything the token can see" }], default: "all" },
      { kind: "boolean", id: "drafts", label: "Drafts", text: "Include draft pull requests", default: false },
    ],
    values: { token: "keychain:pal/github@work-token", org: "zcag" },
    inherited: { org: "serpapi", drafts: true },
    inheritedFrom: "GitHub (Personal)",
    palettes: [
      { id: "github@work-prs", title: "Pull requests (Work)", description: "Open pull requests across the organisation, newest first.", settings: [
        { kind: "select", id: "state", label: "State", options: [{ id: "open", title: "Open" }, { id: "all", title: "Open and closed" }], default: "open" },
        { kind: "boolean", id: "mine", label: "Mine only", text: "Only pull requests I opened or review", default: false },
      ], config: { enabled: true, alias: "wpr", hotkey: "ctrl+alt+w", settings: {} }, inherited: { mine: true } },
      { id: "github@work-issues", title: "Issues (Work)", settings: [], config: { enabled: true, alias: undefined, hotkey: undefined, settings: {} } },
      { id: "github@work-repos", title: "Repositories (Work)", settings: [], config: { enabled: false, alias: undefined, hotkey: undefined, settings: {} } },
    ],
  },
  {
    name: "clipboard",
    key: "clipboard",
    title: "Clipboard",
    description: "What you copied, searchable, with images.",
    icon: { kind: "tile", bg: "violet", glyph: "\u{f014d}" },
    version: "0.9.4",
    repo: "github.com/zcag/pal-clipboard",
    bundled: false,
    status: statusOf("clipboard"),
    installed: now - 20 * d,
    settings: [
      { kind: "number", id: "history", label: "History", description: "Older entries are dropped.", min: 10, max: 5000, step: 10, unit: "entries", default: 200 },
      { kind: "list", id: "exclude", label: "Exclude apps", description: "Nothing copied in these is recorded.", placeholder: "App name", default: ["1Password"] },
      { kind: "boolean", id: "images", label: "Images", text: "Keep copied images", default: true },
    ],
    values: { history: 500, exclude: ["1Password", "Keychain Access"], images: true },
    palettes: [
      { id: "clipboard", title: "Clipboard history", settings: [], config: { enabled: true, alias: "cb", hotkey: "cmd+shift+v", icon: "📋", settings: {} } },
    ],
  },
];

/** `[bar]` as the Bar page reads it: the menu bar target, a dimmer muted, sketchybar with wider spacing. */
export const settingsBar: BarConfig = { target: "menubar", hoverDelay: 250, hoverGrace: 400, menubarHover: false, sketchybarHover: true, sketchybarPosition: "right", menubar: { ...lookDefaults, dim: 40 }, sketchybar: { ...lookDefaults, spacing: 6 } };

/** Four declared bar items with their last render: a badge, a ticking timer with its own mono look, a landed alarm, one hidden by its rule. */
export const settingsBarItems: BarItem[] = [
  { key: "github/notifications", extension: "github", id: "notifications", title: "Notifications", description: "The unread count as a badge; hidden at zero. A click opens the newest five, Open all and Mark all read.", extTitle: "GitHub", extIcon: { kind: "tile", bg: "slate", glyph: "\u{f09b}" }, source: true, refreshEvery: 300, renderedAt: Math.floor(now / 1000) - 120, stale: false, state: { hidden: false, badge: 7, urgent: false, icon: "\u{f09b}", tooltip: "7 unread notifications" }, config: { enabled: true, look: {} } },
  { key: "timer/timer", extension: "timer", id: "timer", title: "Timer", description: "What is left of the soonest timer, a fill under the glyph; amber past two thirds, red near the end, an alarm once it lands.", extTitle: "Timer", extIcon: { kind: "tile", bg: "amber", glyph: "\u{f0954}" }, source: true, refreshEvery: 10, renderedAt: Math.floor(now / 1000) - 5, stale: false, state: { hidden: false, urgent: false, icon: "\u{f0954}", title: "3:12", progress: 0.87, color: "amber", tooltip: "tea (+1 more)" }, config: { enabled: true, hotkey: "ctrl+alt+t", order: 10, look: { font: "mono", width: 72 } } },
  { key: "calendar/upcoming", extension: "calendar", id: "upcoming", title: "Upcoming", description: "The next event and how long until it starts; a strip that colours from muted to amber to red as it nears.", extTitle: "Calendar", extIcon: { kind: "tile", bg: "red", glyph: "\u{f00ed}" }, source: true, renderedAt: Math.floor(now / 1000) - 40, stale: true, state: { hidden: false, urgent: true, icon: "\u{f00ed}", title: "Standup now", tooltip: "Standup, 10:00, now" }, config: { enabled: true, look: { badgeStyle: "none" } } },
  { key: "otp/latest-code", extension: "otp", id: "latest-code", title: "Latest code", description: "The newest verification code from Messages while it is fresh; hidden otherwise.", extTitle: "Verification codes", extIcon: { kind: "tile", bg: "green", glyph: "\u{f0e18}" }, source: true, refreshEvery: 10, renderedAt: Math.floor(now / 1000) - 9, stale: false, state: { hidden: true, urgent: false }, config: { enabled: true, target: "off", look: {} } },
];

export const settingsDiagnostics: Diagnostic[] = [
  { level: "warning", path: "palettes.clipboard.enabld", line: 14, message: "unknown key" },
  { level: "error", path: "", line: 21, message: "invalid string: expected `\"` or `'`" },
];

/** Every field kind, each with a value that differs from its default except the first two. */
export const settingsFieldSpecs: { spec: SettingSpec; value: string | number | boolean | string[] | undefined }[] = [
  { spec: { kind: "text", id: "t", label: "Text", description: "A plain string.", placeholder: "Anything", default: "" }, value: "" },
  { spec: { kind: "text", id: "t2", label: "Text, changed", placeholder: "Anything", default: "main" }, value: "release" },
  { spec: { kind: "secret", id: "s", label: "Secret", description: "Stored in the OS keychain; the file keeps only the reference." }, value: "keychain:pal/github-token" },
  { spec: { kind: "secret", id: "s2", label: "Secret, unset", placeholder: "Paste a token" }, value: undefined },
  { spec: { kind: "number", id: "n", label: "Number", min: 10, max: 5000, step: 10, unit: "entries", default: 200 }, value: 500 },
  { spec: { kind: "boolean", id: "b", label: "Boolean", text: "Include draft pull requests", default: false }, value: true },
  { spec: { kind: "select", id: "sel", label: "Select", options: [{ id: "open", title: "Open" }, { id: "all", title: "Open and closed" }], default: "open" }, value: "all" },
  { spec: { kind: "hotkey", id: "h", label: "Hotkey", description: "Press the new combination while recording." }, value: "cmd+shift+v" },
  { spec: { kind: "hotkey", id: "h2", label: "Hotkey, unset" }, value: undefined },
  { spec: { kind: "path", id: "p", label: "Path", pick: "file", default: "~/Library/Application Support/Google/Chrome/Default/Bookmarks" }, value: "~/Library/Application Support/Google/Chrome/Profile 2/Bookmarks" },
  { spec: { kind: "list", id: "l", label: "List", description: "Enter or a comma adds one.", placeholder: "App name", default: ["1Password"] }, value: ["1Password", "Keychain Access"] },
];

/**
 * Glyph icons as extensions send them: one Nerd Font private-use codepoint
 * each, from the sets the bundled symbols font carries (fonts.css). They
 * must draw as icons on a machine with no Nerd Font installed; the last two
 * are what the same string kinds look like next to them.
 */
/**
 * The first-run tips as the core lists them (`welcome::rows` in
 * app/src-tauri/src/welcome.rs; the copy lives there, this is a mirror for
 * the gallery). The first declares no actions, so Enter on it shows its
 * detail.
 */
const tip = (id: string, name: string, subtitle: string | undefined, icon: string, markdown: string): Item =>
  ({ id, name, subtitle, icon: { kind: "glyph", value: icon }, palette: "welcome", detail: { markdown } });
export const welcomeRows: Item[] = [
  { ...tip("about", "You are in pal: type to search apps, bookmarks, emoji, your clipboard and more", undefined, "\u{f1821}", "# pal\n\nOne search box over everything: apps, bookmarks, emoji, clipboard history, windows, and whatever your extensions add. The sections are the palettes that matched.\n\n- **⌃Space** opens and hides pal from any app\n- **Type** to search; the list narrows as you go\n- **Enter** runs the row's first action, **⌘Enter** its second\n- **⌘K** lists every action for the row\n- **Esc** clears the query, then steps back, then hides\n- **⌘,** opens Settings; **⌘I** shows a row's details, like this one"), actions: [] },
  tip("hotkey", "Change the hotkey", "⌃Space now; Enter opens the recorder in Settings", "\u{f030c}", "# Change the hotkey\n\npal opens with **⌃Space**. Enter opens the recorder under Settings › General: press another combination, or pick a preset. Every palette can have its own hotkey too, on its row under Settings › Palettes."),
  tip("extensions", "Add your own palettes", "A palette is a small TypeScript file; the guide is on GitHub", "\u{f0431}", "# Add your own palettes\n\nEvery palette in pal is an extension, the built-in ones included. An extension is a folder with a `pal.json` and an `index.ts` that lists rows and answers picks. The guide walks through one:\n\nhttps://github.com/zcag/pal/blob/main/docs/extensions.md"),
  tip("github", "Star or report an issue", "github.com/zcag/pal", "\u{f02a4}", "# pal on GitHub\n\nSource, releases and the issue tracker:\n\nhttps://github.com/zcag/pal\n\nA star helps others find it; an issue with what you expected and what happened helps fix it."),
  tip("accessibility", "Grant Accessibility for paste and window switching", "Enter shows the system prompt; nothing is asked until you do", "\u{f0565}", "# Accessibility\n\nPasting a row into the app in front and switching to a window both drive another app, which macOS only allows to apps on its Accessibility list.\n\nEnter here shows the system prompt; the switch is under System Settings › Privacy & Security › Accessibility. pal reads nothing you type."),
  tip("hide", "Hide these tips", "Bring them back any time with “Show tips again” in ⌘K", "\u{f06d1}", "# Hide these tips\n\nThe Welcome section goes and the empty query starts with your palettes and apps. ⌘K at the root has “Show tips again”."),
];

export const nerdGlyphs: Item[] = [
  { id: "nf-md", name: "Terminal", subtitle: "Material Design, U+F018D", icon: { kind: "glyph", value: "\u{f018d}" }, palette: "glyphs", section: "Nerd Font glyphs" },
  { id: "nf-md-pr", name: "Pull requests", subtitle: "Material Design, U+F062C", icon: { kind: "glyph", value: "\u{f062c}" }, palette: "glyphs", section: "Nerd Font glyphs" },
  { id: "nf-fa", name: "Bookmark", subtitle: "Font Awesome, U+F02E", icon: { kind: "glyph", value: "\u{f02e}" }, palette: "glyphs", section: "Nerd Font glyphs" },
  { id: "nf-cod", name: "Review", subtitle: "Codicons, U+EA84", icon: { kind: "glyph", value: "\u{ea84}" }, palette: "glyphs", section: "Nerd Font glyphs" },
  { id: "nf-seti", name: "GitLab", subtitle: "Seti, U+E65C", icon: { kind: "glyph", value: "\u{e65c}" }, palette: "glyphs", section: "Nerd Font glyphs" },
  { id: "nf-dev", name: "Rust", subtitle: "Devicons, U+E7A8", icon: { kind: "glyph", value: "\u{e7a8}" }, palette: "glyphs", section: "Nerd Font glyphs" },
  { id: "nf-weather", name: "Sunny", subtitle: "Weather Icons, U+E30D", icon: { kind: "glyph", value: "\u{e30d}" }, palette: "glyphs", section: "Nerd Font glyphs" },
  { id: "nf-pl", name: "Branch", subtitle: "Powerline, U+E0A0", icon: { kind: "glyph", value: "\u{e0a0}" }, palette: "glyphs", section: "Nerd Font glyphs" },
  { id: "nf-tinted", name: "Deploy", subtitle: "Tinted, U+F06B0", icon: { kind: "glyph", value: "\u{f06b0}", color: "#8b7cf6" }, palette: "glyphs", section: "Nerd Font glyphs" },
  { id: "nf-xdg", name: "No calculator found", subtitle: "xdg dialog-error, mapped by sdk/src/icons.ts", icon: { kind: "glyph", value: "\u{f0029}" }, palette: "glyphs", section: "Nerd Font glyphs" },
  { id: "nf-text", name: "Search", subtitle: "Text glyph, stays in the mono font", icon: { kind: "glyph", value: "⌕" }, palette: "glyphs", section: "Nerd Font glyphs" },
  { id: "nf-emoji", name: "Sparkles", subtitle: "Emoji, the platform colour font", icon: { kind: "emoji", value: "✨" }, palette: "glyphs", section: "Nerd Font glyphs" },
];

/**
 * The bundled extensions' icon tiles, read from their manifests (the
 * gallery's tile board is the manifests, not a copy): one palette row per
 * extension in load order, plus a row of the extension's own colour
 * (`tint`) as its rows carry it.
 */
const manifests = import.meta.glob<{ default: { name: string; title: string; icon?: unknown } }>("../../../extensions/*/pal.json", { eager: true });
/** One bundled extension's manifest title and icon, for a level keyed on the extension without a source of its own (a bar item's popover in bar-shot.tsx). */
export const manifestOf = (name: string) => Object.values(manifests).map((m) => m.default).find((m) => m.name === name);
export const tileRows: Item[] = Object.values(manifests)
  .map((m) => m.default)
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((m) => ({ id: m.name, name: m.title, subtitle: m.name, icon: iconFromWire(m.icon, m.title), palette: "palettes", accessories: [{ text: "Palette" }] }));

/**
 * The store as pal's registry lists it, for Browse's gallery state
 * (`?gallery=settings:extensions&browse`): every extension in the repo,
 * its listing made from its manifest as pal-pack makes it (the tile, the
 * tagline, the description, `store.features`, the palettes, the
 * screenshots served from the extension's folder), on a machine with the
 * 33 that come with pal (distribution.md, "What is bundled"), GitHub and
 * Wordle installed from the registry, Spotify installing, and acme's Todo
 * beside them. Docker's install fails (the gallery store's fake).
 */
type Manifest = { name: string; title?: string; description?: string; keywords?: string[]; icon?: unknown; author?: string; requires?: string[]; suggests?: string[]; palettes?: Record<string, { title?: string; kind?: string }>; store?: { tagline?: string; category?: string; features?: string[]; platforms?: string[]; play?: boolean; screenshots?: { file: string; caption?: string }[] } };
const BUNDLED_09 = new Set("apps files calc clipboard snippets windows window-management system quicklinks emoji store games states scripts bookmarks browser-tabs downloads audio bluetooth displays wifi network media screenshots timer processes power menu-bar shortcuts unicode generate colors shell".split(" "));
const listingOf = (m: Manifest): Listing => ({
  title: m.title ?? m.name, description: m.description ?? "", tagline: m.store?.tagline ?? "", category: m.store?.category ?? "", keywords: m.keywords ?? [], icon: m.icon ?? null, author: m.author ?? "",
  platforms: m.store?.platforms ?? null, play: !!m.store?.play, features: m.store?.features ?? [],
  palettes: Object.entries(m.palettes ?? {}).map(([id, p]) => ({ id, title: p.title ?? m.title ?? id, kind: p.kind ?? "list" })),
  screenshots: (m.store?.screenshots ?? []).map((s) => ({ url: `/__ext/${m.name}/screenshots/${s.file}`, caption: s.caption })), requires: m.requires ?? [], suggests: m.suggests ?? [],
});
const registryManifests = Object.values(manifests).map((m) => m.default as Manifest).sort((a, b) => a.name.localeCompare(b.name));
export const browseStore: StoreState = {
  ...settingsStore,
  registries: [{ ...settingsStore.registries[0], count: registryManifests.length }, { ...settingsStore.registries[1], last_error: null, last_ok: settingsStore.registries[1].last_checked }],
  available: [
    ...registryManifests.map((m) => {
      const bundled = BUNDLED_09.has(m.name);
      return { name: m.name, registry: "pal", listing: listingOf(m), installed: bundled || m.name === "github" || m.name === "wordle", bundled, installable: m.name !== "dpi", ...(m.name === "dpi" && { blocked: "not for this platform" }), build: info(`${m.name}0000000000000000`.slice(0, 16), 3) };
    }),
    settingsStore.available.find((a) => a.name === "todo")!,
  ],
  pending: [], rolled_back: [], unlisted: [], leftovers: [], disabled: [],
  busy: ["spotify"],
};
