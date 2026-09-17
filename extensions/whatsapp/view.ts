// The bar popover as a render tree (`View` in `@zcag/pal`), pure: the
// gallery renders a fixture state with this same function, the tests
// assert on it. The unread chats in two sections (direct messages, then
// groups), each row the picture (a data url; the initial on a green
// tile while there is none), the name, the newest message on one line
// with who wrote it, the time and the count; a cursor (`selected`) the
// arrows move and a click sets; the keys as keycap hints. Replying turns
// the search row into a text field (`View.input`) and the hints into
// Send / Cancel. Nothing unread is one calm line, with the recent chats
// as rows when the item stays on the bar (`unread_only_bar` off).
import { POPOVER_W, column, keyHint, row, text, type Action, type HexColor, type View, type ViewNode } from "@zcag/pal";

/** One row of the popover, everything already formatted (the time in the user's locale, the text on one line). */
export type BarRow = {
  /** The chat's id: the action a click runs is `focus:` + this. */
  id: string;
  name: string;
  group: boolean;
  /** The newest message on one line, the sender before it in a group. */
  text: string;
  time?: string;
  /** Unread messages; 0 for a recent chat listed while nothing is unread. */
  n: number;
  /** The picture as a data url. */
  avatar?: string;
};
export type BarState = {
  rows: BarRow[];
  /** Which row the keys act on. */
  focus: number;
  /** The row a reply is being typed for (its id), while the field is up. */
  replying?: string;
  /** What the field should hold: the draft a failed send gives back. */
  draft?: string;
  /** Replies are allowed (`send` on): the `r` key and its hint. */
  canSend: boolean;
  /** Direct chats among the rows are unread (the strip is urgent). */
  urgent?: boolean;
};

const AVATAR = 28;
/** A row's inner width (its own padding of one step a side), and the text column left after the avatar, the time and a badge with their gaps. */
const ROW_W = POPOVER_W - 8, TIME_W = 58, BADGE_W = 30, TEXT_W = ROW_W - AVATAR - TIME_W - BADGE_W - 3 * 8;
/** Rows per section. */
export const SECTION_ROWS = 5;


/** WhatsApp's own avatar greens and teals plus a few warm ones, one picked by the name's hash: the initial's tile while there is no picture. */
const AVATAR_COLORS: HexColor[] = ["#25d366", "#128c7e", "#075e54", "#34b7f1", "#e0a800", "#d9534f", "#7b61ff", "#f06292"];
export const avatarColor = (name: string): HexColor => { let h = 5381; for (const ch of name) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length]; };
export const initial = (name: string) => { const n = name.replace(/^[+#\s]+/, "").trim(); return n ? [...n][0]!.toUpperCase() : "?"; };

/** The initial on its tile as a data url, for a row's `{ image }` icon: the same colour the popover's tile takes. */
export function initialIcon(name: string): { image: string } {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${avatarColor(name)}"/><text x="32" y="42" font-family="system-ui" font-size="32" font-weight="700" fill="#fff" text-anchor="middle">${initial(name).replace(/[<>&]/g, "")}</text></svg>`;
  return { image: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
}

function avatar(r: BarRow): ViewNode {
  if (r.avatar) return { type: "image", key: "av", src: r.avatar, width: AVATAR, height: AVATAR, mask: "circle", alt: r.name };
  return { type: "tile", key: "av", width: AVATAR, height: AVATAR, text: initial(r.name), color: avatarColor(r.name), fill: "solid" };
}

function rowNode(r: BarRow, focused: boolean, replying: boolean): ViewNode {
  const count = r.n > 0 ? String(r.n) : undefined;
  return row(
    [
      avatar(r),
      column([text(r.name, { size: "md", weight: "semibold", width: TEXT_W }), text(r.text || "(no text)", { size: "sm", color: replying ? "accent" : "muted", width: TEXT_W })], { key: "t", gap: 0 }),
      text(r.time ?? "", { size: "xs", color: "faint", width: TIME_W, align: "end" }),
      count ? { type: "badge", key: "n", text: count, color: "green" } : { type: "spacer", key: "n", size: BADGE_W },
    ],
    { key: r.id, padding: 1, minHeight: 44, radius: true, surface: focused ? "elevated" : undefined, selected: focused || undefined, action: `focus:${r.id}`, transition: { enter: "fade", exit: "fade" } },
  );
}

function section(title: string, key: string, rows: BarRow[], st: BarState, offset: number): ViewNode[] {
  if (!rows.length) return [];
  const label = row([text(title, { size: "xs", weight: "semibold", color: "muted" }), { type: "badge", text: String(rows.length), color: "grey" }], { key: `h-${key}`, gap: 1, minHeight: 24 });
  return [column([label, ...rows.map((r, i) => rowNode(r, offset + i === st.focus, st.replying === r.id))], { key: `s-${key}`, gap: 0 })];
}

function hints(st: BarState, cur: BarRow | undefined): ViewNode {
  if (st.replying) return row([...keyHint("enter", "send"), ...keyHint("escape", "cancel")], { key: "hints", gap: 1, minHeight: 22 });
  const kids: ViewNode[] = [...keyHint("enter", "open")];
  if (cur && st.canSend) kids.push(...keyHint("r", "reply"));
  if (cur && cur.n > 0) kids.push(...keyHint("m", "read"));
  if (st.rows.some((r) => r.n > 0)) kids.push(...keyHint("a", "all read"));
  kids.push(...keyHint("o", "WhatsApp"), ...keyHint("p", "pal"));
  return row(kids, { key: "hints", gap: 1, minHeight: 22 });
}

export function actions(st: BarState): Action[] {
  const cur = st.rows[st.focus];
  const clicks: Action[] = st.rows.map((r): Action => ({ id: `focus:${r.id}`, title: `Go to ${r.name}`, hidden: true }));
  if (st.replying) return [{ id: "send", title: "Send" }, { id: "cancel", title: "Cancel reply" }, ...clicks];
  return [
    { id: "open", title: cur ? (cur.group ? "Open WhatsApp" : `Open chat with ${cur.name}`) : "Open WhatsApp" },
    ...(cur && st.canSend ? [{ id: "reply", title: `Reply to ${cur.name}`, shortcut: "r" }] : []),
    ...(cur && cur.n > 0 ? [{ id: "read", title: `Mark ${cur.name} read`, shortcut: "m" }] : []),
    ...(st.rows.some((r) => r.n > 0) ? [{ id: "read-all", title: "Mark all read", shortcut: ["a", "cmd+shift+a"], style: "destructive" } as Action] : []),
    { id: "open-whatsapp", title: "Open WhatsApp", shortcut: "o" },
    { id: "open-pal", title: "Open in pal", shortcut: "p" },
    { id: "web", title: "Open in the web client", shortcut: "cmd+shift+o" },
    { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
    ...clicks,
  ];
}

export function render(st: BarState): View {
  const direct = st.rows.filter((r) => !r.group), groups = st.rows.filter((r) => r.group);
  const unread = st.rows.filter((r) => r.n > 0).length;
  let tree: ViewNode;
  if (!st.rows.length) {
    tree = column(
      [
        { type: "tile", key: "zero", width: 48, height: 48, text: "✓", color: "green", fill: "soft" },
        text("Nothing unread", { style: "title", key: "zero-t" }),
        text("Every chat is read", { style: "muted", size: "sm", align: "center" }),
        row([...keyHint("o", "WhatsApp"), ...keyHint("p", "pal")], { key: "hints", gap: 1, minHeight: 22 }),
      ],
      { key: "compact", padding: 3, gap: 2, align: "center" },
    );
  } else {
    // The rows are listed direct first, so the offsets follow the order `st.rows` has.
    const sections = [...section(unread ? "Direct messages" : "Recent", "direct", direct, st, 0), ...section(unread ? "Groups" : "Recent groups", "groups", groups, st, direct.length)];
    tree = column([...sections, hints(st, st.rows[st.focus])], { key: "compact", padding: 3, gap: 2 });
  }
  const cur = st.rows.find((r) => r.id === st.replying);
  const title = st.replying ? `Reply to ${cur?.name ?? "WhatsApp"}` : unread ? `${unread} ${unread === 1 ? "chat" : "chats"} unread` : "WhatsApp";
  return {
    tree,
    actions: actions(st),
    title,
    id: "unread",
    keys: "actions",
    ...(st.replying && { input: { value: st.draft ?? "", placeholder: cur ? `Message ${cur.name}` : "Message", submit: "send", cancel: "cancel" } }),
  };
}
