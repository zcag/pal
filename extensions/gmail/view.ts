// The bar popover as a render tree (`View` in `@zcag/pal`), pure: the
// gallery renders a fixture state with this same function, the tests
// assert on it. The newest unread messages as rows — the sender's mark,
// who wrote it, the subject, the snippet under it, the time, and a star
// or a paperclip where there is one; a cursor (`selected`) the arrows
// move and a click sets; the keys as keycap hints. Nothing unread is one
// calm line. The same shape Slack's and WhatsApp's popovers take, so the
// three inboxes read alike.
import { POPOVER_W, column, keyHint, row, text, type Action, type View, type ViewNode } from "@zcag/pal";

/** One row of the popover, everything already formatted (the time in the user's locale, the text on one line). */
export type BarRow = {
  /** The message id: the action a click runs is `focus:` + this. */
  id: string;
  /** The sender's display name. */
  who: string;
  subject: string;
  /** The first line of the body, as Gmail's snippet gives it. */
  snippet: string;
  time?: string;
  starred?: boolean;
  attached?: boolean;
  /** The sender's mark as a data url; the initial's tile while there is none. */
  avatar?: { image: string };
};

export type BarState = {
  rows: BarRow[];
  /** Which row the keys act on. */
  focus: number;
  /** Unread messages in the mailbox, which may be more than the page the rows came from. */
  total: number;
  /** The mailbox the rows came from, named in the title. */
  address?: string;
};

const AVATAR = 28;
/** A row's inner width (its own padding of one step a side), and the text column left after the avatar, the time and the marks with their gaps. */
const ROW_W = POPOVER_W - 8, TIME_W = 52, MARK_W = 16, TEXT_W = ROW_W - AVATAR - TIME_W - MARK_W - 3 * 8;
const STAR = "\u{f04ce}", CLIP = "\u{f0439}";

function rowNode(r: BarRow, focused: boolean): ViewNode {
  const marks: ViewNode[] = [];
  if (r.starred) marks.push(text(STAR, { key: "st", size: "sm", color: "amber" }));
  else if (r.attached) marks.push(text(CLIP, { key: "at", size: "sm", color: "faint" }));
  return row(
    [
      r.avatar ? { type: "image", key: "av", src: r.avatar.image, width: AVATAR, height: AVATAR, mask: "circle", alt: r.who } : { type: "spacer", key: "av", size: AVATAR },
      column(
        [
          row([text(r.who, { size: "md", weight: "semibold", width: TEXT_W - 0 })], { key: "w", gap: 1 }),
          text(r.subject || "(no subject)", { size: "sm", width: TEXT_W }),
          text(r.snippet, { size: "xs", color: "muted", width: TEXT_W }),
        ],
        { key: "t", gap: 0 },
      ),
      text(r.time ?? "", { size: "xs", color: "faint", width: TIME_W, align: "end" }),
      marks.length ? marks[0]! : { type: "spacer", key: "mk", size: MARK_W },
    ],
    { key: r.id, padding: 1, minHeight: 52, radius: true, surface: focused ? "elevated" : undefined, selected: focused || undefined, action: `focus:${r.id}`, transition: { enter: "fade", exit: "fade" } },
  );
}

function hints(st: BarState, cur: BarRow | undefined): ViewNode {
  const kids: ViewNode[] = [...keyHint("enter", "open")];
  if (cur) kids.push(...keyHint("m", "read"), ...keyHint("s", cur.starred ? "unstar" : "star"));
  if (st.rows.length) kids.push(...keyHint("a", "all read"));
  kids.push(...keyHint("o", "Gmail"), ...keyHint("p", "pal"));
  return row(kids, { key: "hints", gap: 1, minHeight: 22 });
}

export function actions(st: BarState): Action[] {
  const cur = st.rows[st.focus];
  const clicks: Action[] = st.rows.map((r): Action => ({ id: `focus:${r.id}`, title: `Go to ${r.who}`, hidden: true }));
  return [
    { id: "open", title: cur ? `Open ${cur.subject || "message"} in Gmail` : "Open Gmail" },
    ...(cur ? [{ id: "read", title: "Mark as read", shortcut: "m" } as Action] : []),
    ...(cur ? [{ id: "star", title: cur.starred ? "Remove star" : "Star", shortcut: "s" } as Action] : []),
    ...(st.rows.length ? [{ id: "read-all", title: "Mark all read", shortcut: ["a", "cmd+shift+a"], style: "destructive" } as Action] : []),
    { id: "open-gmail", title: "Open Gmail", shortcut: "o" },
    { id: "open-pal", title: "Open in pal", shortcut: "p" },
    ...(cur ? [{ id: "copy", title: "Copy the subject", shortcut: "cmd+c" } as Action] : []),
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
        text("Nothing unread", { style: "title", key: "zero-t" }),
        text(st.address ? `${st.address} is read` : "Every message is read", { style: "muted", size: "sm", align: "center" }),
        row([...keyHint("o", "Gmail"), ...keyHint("p", "pal")], { key: "hints", gap: 1, minHeight: 22 }),
      ],
      { key: "compact", padding: 3, gap: 2, align: "center" },
    );
  } else {
    const rest = st.total - st.rows.length;
    const kids: ViewNode[] = st.rows.map((r, i) => rowNode(r, i === st.focus));
    // Every unread the item fetched is a row (the popover scrolls); the count only earns a line past a full page, when the mailbox holds more than that.
    if (rest > 0) kids.push(text(`and ${rest} more unread`, { key: "more", size: "xs", color: "faint" }));
    tree = column([column(kids, { key: "rows", gap: 0 }), hints(st, st.rows[st.focus])], { key: "compact", padding: 3, gap: 2 });
  }
  return {
    tree,
    actions: actions(st),
    title: st.total ? `${st.total} unread` : "Gmail",
    id: "unread",
    keys: "actions",
  };
}
