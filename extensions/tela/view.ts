// The bar popover as a render tree (`View` in `@zcag/pal`), pure: the
// gallery renders a fixture state with this same function, the tests
// assert on it. The unread mentions and replies as rows — the kind's
// glyph, what happened, the comment's snippet under it, the time — with
// a cursor (`selected`) the arrows move and a click sets, and the keys
// as keycap hints. The same shape Gmail's, Slack's and WhatsApp's
// popovers take, so the inboxes read alike.
import { POPOVER_W, column, keyHint, row, text, type Action, type View, type ViewNode } from "@zcag/pal";

/** One row of the popover, everything already formatted. */
export type BarRow = {
  /** The notification's id: the action a click runs is `focus:` + this. */
  id: string;
  /** What happened, as `describe` puts it ("Mara mentioned you on Parser notes"). */
  title: string;
  /** The comment's first line, where it has one. */
  snippet?: string;
  /** A mention rather than a reply: the two take their own glyph. */
  mention: boolean;
  time?: string;
};

export type BarState = {
  rows: BarRow[];
  /** Which row the keys act on. */
  focus: number;
  /** Addressed notifications in all, the title's count. */
  total: number;
};

/** A row's inner width (its own padding of one step a side), and the text column left after the glyph and the time. */
const ROW_W = POPOVER_W - 8, GLYPH_W = 20, TIME_W = 52, TEXT_W = ROW_W - GLYPH_W - TIME_W - 2 * 8;
const MENTION = "\u{f0016}", REPLY = "\u{f0179}";

function rowNode(r: BarRow, focused: boolean): ViewNode {
  const kids: ViewNode[] = [text(r.title, { size: "md", weight: "semibold", width: TEXT_W })];
  if (r.snippet) kids.push(text(r.snippet, { size: "sm", color: "muted", width: TEXT_W }));
  return row(
    [
      text(r.mention ? MENTION : REPLY, { key: "g", size: "sm", color: r.mention ? "accent" : "faint", width: GLYPH_W }),
      column(kids, { key: "t", gap: 0 }),
      text(r.time ?? "", { size: "xs", color: "faint", width: TIME_W, align: "end" }),
    ],
    { key: r.id, padding: 1, minHeight: 44, radius: true, surface: focused ? "elevated" : undefined, selected: focused || undefined, action: `focus:${r.id}`, transition: { enter: "fade", exit: "fade" } },
  );
}

function hints(st: BarState, cur: BarRow | undefined): ViewNode {
  const kids: ViewNode[] = [...keyHint("enter", "open")];
  if (cur) kids.push(...keyHint("m", "read"));
  if (st.rows.length) kids.push(...keyHint("a", "all read"));
  kids.push(...keyHint("o", "tela"), ...keyHint("p", "pal"));
  return row(kids, { key: "hints", gap: 1, minHeight: 22 });
}

export function actions(st: BarState): Action[] {
  const cur = st.rows[st.focus];
  const clicks: Action[] = st.rows.map((r): Action => ({ id: `focus:${r.id}`, title: `Go to ${r.title}`, hidden: true }));
  return [
    { id: "open", title: cur ? "Open the comment in tela" : "Open tela" },
    ...(cur ? [{ id: "read", title: "Mark as read", shortcut: "m" } as Action] : []),
    ...(st.rows.length ? [{ id: "read-all", title: "Mark all read", shortcut: ["a", "cmd+shift+a"], style: "destructive" } as Action] : []),
    { id: "open-tela", title: "Open tela", shortcut: "o" },
    { id: "open-pal", title: "Open in pal", shortcut: "p" },
    { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
    ...clicks,
  ];
}

export function render(st: BarState): View {
  let tree: ViewNode;
  if (!st.rows.length) {
    tree = column(
      [
        { type: "tile", key: "zero", width: 48, height: 48, text: "\u2713", color: "green", fill: "soft" },
        text("Nothing addressed to you", { style: "title", key: "zero-t" }),
        text("No unread mentions or replies", { style: "muted", size: "sm", align: "center" }),
        row([...keyHint("o", "tela"), ...keyHint("p", "pal")], { key: "hints", gap: 1, minHeight: 22 }),
      ],
      { key: "compact", padding: 3, gap: 2, align: "center" },
    );
  } else {
    const kids: ViewNode[] = st.rows.map((r, i) => rowNode(r, i === st.focus));
    tree = column([column(kids, { key: "rows", gap: 0 }), hints(st, st.rows[st.focus])], { key: "compact", padding: 3, gap: 2 });
  }
  return {
    tree,
    actions: actions(st),
    title: st.total ? `${st.total} addressed to you` : "tela",
    id: "inbox",
    keys: "actions",
  };
}
