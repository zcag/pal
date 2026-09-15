/** Hand-written items exercising every field, plus a fixture sample. */
import { toItem, type Raw } from "../fixtures";
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
  { kind: "text", id: "title", label: "Title", placeholder: "What is this bookmark called?", value: "Raycast API reference" },
  { kind: "text", id: "url", label: "URL", placeholder: "https://" },
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
