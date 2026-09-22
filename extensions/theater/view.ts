// The four bar popovers as one render tree shape (`View` in
// `@zcag/pal`), pure: rows with a glyph or a poster, a title, a line
// under it, a tag and a figure on the right, a thin progress bar where
// the row is something that moves; a cursor (`selected`) the arrows move
// and a click sets; the keys as keycap hints. Which keys exist depends
// on the item (`kind`): downloads pause everything on space, requests
// approve on `a` and decline on `d`, sessions pause on space, queue
// items leave on backspace.
import { POPOVER_W, column, keyHint, row, text, type Action, type TagColor, type View, type ViewNode } from "@zcag/pal";

export type PopKind = "downloads" | "playing" | "requests" | "queue";
export type PopRow = {
  id: string;
  title: string;
  subtitle?: string;
  /** A Nerd Font glyph in the first column, or a data-url picture (a poster) in its place. */
  glyph?: string;
  glyphColor?: "accent" | "muted" | "faint" | TagColor;
  image?: string;
  tag?: { text: string; color: TagColor };
  /** The figure on the right: a percentage, a speed, a time. */
  right?: string;
  progress?: number;
  progressColor?: TagColor;
  /** Downloads: the row is paused (space resumes); requests: nothing; playing: the session is paused. */
  paused?: boolean;
};
export type PopState = {
  kind: PopKind;
  title: string;
  /** One line above the rows: the total speed, who is watching, the counts. */
  summary?: string;
  rows: PopRow[];
  focus: number;
  /** Downloads: every client is paused, so space resumes. */
  allPaused?: boolean;
  empty: { title: string; sub: string };
};

/** Two steps of padding a side on the outer column, one on a row, then the columns: the glyph, the text, the figure. */
const OUTER = 3, ROW_PAD = 1;
const INNER_W = POPOVER_W - 2 * 4 * OUTER;
const ROW_W = INNER_W - 2 * 4 * ROW_PAD;
const GLYPH_W = 28, RIGHT_W = 64, GAP = 8;
const TEXT_W = ROW_W - GLYPH_W - RIGHT_W - 2 * GAP;

function rowNode(r: PopRow, focused: boolean): ViewNode {
  const lead: ViewNode = r.image
    ? { type: "image", key: "g", src: r.image, width: 24, height: 24, mask: "rounded" }
    : text(r.glyph ?? "\u{f0997}", { key: "g", style: "glyph", size: "md", color: r.glyphColor ?? "muted", width: GLYPH_W });
  const body: ViewNode[] = [text(r.title, { key: "t", size: "md", weight: "semibold", width: TEXT_W })];
  if (r.subtitle) body.push(text(r.subtitle, { key: "s", size: "xs", color: "muted", width: TEXT_W }));
  if (r.progress !== undefined) body.push({ type: "progress", key: "p", value: Math.max(0, Math.min(1, r.progress)), width: TEXT_W, color: r.progressColor });
  const right: ViewNode[] = [];
  if (r.tag) right.push({ type: "badge", key: "b", text: r.tag.text, color: r.tag.color });
  if (r.right) right.push(text(r.right, { key: "r", style: "number", size: "xs", color: "muted" }));
  return row(
    [{ type: "stack", key: "lead", direction: "column", align: "center", children: [lead] }, column(body, { key: "body", gap: 1 }), column(right, { key: "right", gap: 1, align: "end" })],
    { key: r.id, padding: ROW_PAD, gap: 2, minHeight: 44, radius: true, surface: focused ? "elevated" : undefined, selected: focused || undefined, action: `focus:${r.id}`, transition: { enter: "fade", exit: "fade" } },
  );
}

function hints(st: PopState): ViewNode {
  const cur = st.rows[st.focus];
  const kids: ViewNode[] = [...keyHint("enter", "open")];
  switch (st.kind) {
    case "downloads": kids.push(...keyHint("space", st.allPaused ? "resume all" : "pause all")); if (cur) kids.push(...keyHint("backspace", "delete")); break;
    case "playing": if (cur) kids.push(...keyHint("space", cur.paused ? "resume" : "pause")); break;
    case "requests": if (cur) kids.push(...keyHint("a", "approve"), ...keyHint("d", "decline")); break;
    case "queue": if (cur) kids.push(...keyHint("backspace", "remove")); break;
  }
  kids.push(...keyHint("p", "pal"));
  return row(kids, { key: "hints", gap: 1, minHeight: 22 });
}

export function actions(st: PopState): Action[] {
  const cur = st.rows[st.focus];
  const own: Action[] = [];
  switch (st.kind) {
    case "downloads":
      own.push({ id: "toggle-all", title: st.allPaused ? "Resume everything" : "Pause everything", shortcut: "space" });
      if (cur) own.push({ id: "toggle", title: cur.paused ? "Resume the item" : "Pause the item", shortcut: "cmd+enter" }, { id: "delete", title: "Delete the item", shortcut: "backspace", style: "destructive", confirm: `Delete ${cur.title}?` });
      break;
    case "playing": if (cur) own.push({ id: "playpause", title: cur.paused ? "Resume" : "Pause", shortcut: "space" }); break;
    case "requests": if (cur) own.push({ id: "approve", title: "Approve", shortcut: "a" }, { id: "decline", title: "Decline", shortcut: "d", style: "destructive", confirm: `Decline ${cur.title}?` }); break;
    case "queue": if (cur) own.push({ id: "remove", title: "Remove from the queue", shortcut: "backspace", style: "destructive", confirm: `Remove ${cur.title} from the queue?` }); break;
  }
  return [
    { id: "open", title: cur ? `Open ${cur.title}` : "Open" },
    ...own,
    { id: "open-pal", title: "Open in pal", shortcut: "p" },
    { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
    ...st.rows.map((r): Action => ({ id: `focus:${r.id}`, title: `Go to ${r.title}`, hidden: true })),
  ];
}

export function render(st: PopState): View {
  let tree: ViewNode;
  if (!st.rows.length) {
    tree = column(
      [
        { type: "tile", key: "zero", width: 48, height: 48, text: "✓", color: "green", fill: "soft" },
        text(st.empty.title, { style: "title", key: "zero-t" }),
        text(st.empty.sub, { style: "muted", size: "sm", align: "center" }),
        row([...keyHint("p", "pal")], { key: "hints", gap: 1, minHeight: 22 }),
      ],
      { key: "compact", padding: OUTER, gap: 2, align: "center" },
    );
  } else {
    const kids: ViewNode[] = [];
    if (st.summary) kids.push(text(st.summary, { key: "summary", size: "xs", color: "muted" }));
    kids.push(column(st.rows.map((r, i) => rowNode(r, i === st.focus)), { key: "rows", gap: 0 }), hints(st));
    tree = column(kids, { key: "compact", padding: OUTER, gap: 2 });
  }
  return { tree, actions: actions(st), title: st.title, id: st.kind, keys: "actions" };
}
