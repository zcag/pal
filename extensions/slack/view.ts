// The bar popover as a render tree (`View` in `@zcag/pal`), pure: the
// gallery renders a fixture state with this same function. What is
// addressed to you as three sections (direct messages, mentions, thread
// replies), each row the sender's avatar (a data url; an initial in a
// colour hashed from the name while the picture is not at hand), the
// conversation, the message on one line, the time and a count; a cursor
// (`selected`) the arrows move and a click sets; the channels that are
// only unread as a row of badges (a click opens one); the keys as
// keycap hints. Replying turns the search row into a text field
// (`View.input`) and the hints into Send / Cancel. Inbox zero is one
// calm line.
import { POPOVER_W, column, keyHint, row, text, type Action, type HexColor, type TagColor, type View, type ViewNode } from "@zcag/pal";
import type { Kind } from "./data.ts";

/** One row of the popover, everything already formatted (the time in the user's locale, the text on one line). */
export type BarRow = {
  /** `<kind>:<team>/<conversation>`: the action a click runs is `focus:` + this. */
  id: string;
  kind: Kind;
  /** The person, `#channel`, the people of a group message. */
  where: string;
  /** Who wrote the message, when the row's name does not say (a channel). */
  who?: string;
  text: string;
  time?: string;
  n: number;
  more: boolean;
  /** The sender's picture as a data url. */
  avatar?: string;
  /** A direct message's presence dot on the picture: green while the person is active, grey away; none when unknown. */
  dot?: TagColor;
  canReply: boolean;
  canRead: boolean;
  teamName?: string;
};
export type BarState = {
  rows: BarRow[];
  /** Channels that are only unread: named, with the total when more are cut. */
  quiet: { id: string; name: string }[];
  quietTotal: number;
  /** Which row the keys act on. */
  focus: number;
  /** The row a reply is being typed for (its id), while the field is up. */
  replying?: string;
  /** What the field should hold: the draft a failed send gives back. */
  draft?: string;
};

export const SECTION: Record<Kind, string> = { dm: "Direct messages", mention: "Mentions", thread: "Threads", channel: "Channels" };
const AVATAR = 28;
/** A row's inner width (its own padding of one step a side), and the text column left after the avatar, the time and a badge with their gaps. */
const ROW_W = POPOVER_W - 8, TIME_W = 58, BADGE_W = 30, TEXT_W = ROW_W - AVATAR - TIME_W - BADGE_W - 3 * 8;
/** Quiet channels drawn as badges before a "+N" one. */
export const QUIET_SHOWN = 4;


/** Slack's own avatar palette, one picked by the name's hash: the initial's tile while the picture is not loaded. */
const AVATAR_COLORS: HexColor[] = ["#e01e5a", "#ecb22e", "#2eb67d", "#36c5f0", "#4a154b", "#1264a3", "#e8912d", "#7c3085"];
export const avatarColor = (name: string): HexColor => { let h = 5381; for (const ch of name) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length]; };
const initial = (name: string) => { const n = name.replace(/^#/, "").trim(); return n ? [...n][0]!.toUpperCase() : "?"; };

/** The row's mark: the picture (with the presence dot on its corner), else the initial in its colour; a channel row with no sender takes a hash. */
function avatar(r: BarRow): ViewNode {
  if (r.avatar) return { type: "image", key: "av", src: r.avatar, width: AVATAR, height: AVATAR, mask: "circle", alt: r.who ?? r.where, dot: r.dot };
  const name = r.who ?? r.where;
  return { type: "tile", key: "av", width: AVATAR, height: AVATAR, text: r.kind === "thread" ? "#" : initial(name), color: avatarColor(name), fill: "solid" };
}

function rowNode(r: BarRow, focused: boolean, replying: boolean): ViewNode {
  const line = r.kind === "thread" ? `${r.n} new ${r.n === 1 ? "reply" : "replies"} in threads you follow` : r.who && r.who !== r.where ? `${r.who}: ${r.text}` : r.text;
  const count = r.kind === "thread" ? String(r.n) : r.n > 1 ? `${r.n}${r.more ? "+" : ""}` : undefined;
  const name = r.teamName ? `${r.where} · ${r.teamName}` : r.where;
  return row(
    [
      avatar(r),
      column([text(name, { size: "md", weight: "semibold", width: TEXT_W }), text(line || "(no text)", { size: "sm", color: replying ? "accent" : "muted", width: TEXT_W })], { key: "t", gap: 0 }),
      text(r.time ?? "", { size: "xs", color: "faint", width: TIME_W, align: "end" }),
      count ? { type: "badge", key: "n", text: count, color: r.kind === "thread" ? "blue" : "red" } : { type: "spacer", key: "n", size: BADGE_W },
    ],
    { key: r.id, padding: 1, minHeight: 44, radius: true, surface: focused ? "elevated" : undefined, selected: focused || undefined, action: `focus:${r.id}`, transition: { enter: "fade", exit: "fade" } },
  );
}

function section(kind: Kind, rows: BarRow[], st: BarState, offset: number): ViewNode[] {
  if (!rows.length) return [];
  const label = row([text(SECTION[kind], { size: "xs", weight: "semibold", color: "muted" }), { type: "badge", text: String(rows.length), color: "grey" }], { key: `h-${kind}`, gap: 1, minHeight: 24 });
  return [column([label, ...rows.map((r, i) => rowNode(r, offset + i === st.focus, st.replying === r.id))], { key: `s-${kind}`, gap: 0 })];
}

function quietRow(st: BarState): ViewNode[] {
  if (!st.quiet.length) return [];
  const shown = st.quiet.slice(0, QUIET_SHOWN);
  const rest = st.quietTotal - shown.length;
  return [row([
    text("Also unread", { size: "xs", weight: "semibold", color: "muted" }),
    ...shown.map((c): ViewNode => ({ type: "badge", key: c.id, text: c.name, color: "grey", action: `open:${c.id}` })),
    ...(rest > 0 ? [{ type: "badge", key: "more", text: `+${rest}`, color: "grey" } as ViewNode] : []),
  ], { key: "quiet", gap: 1, minHeight: 22 })];
}

function hints(st: BarState, cur: BarRow | undefined): ViewNode {
  if (st.replying) return row([...keyHint("enter", "send"), ...keyHint("escape", "cancel")], { key: "hints", gap: 1, minHeight: 22 });
  const kids: ViewNode[] = [...keyHint("enter", "open")];
  if (cur?.canReply) kids.push(...keyHint("r", "reply"));
  if (cur?.canRead) kids.push(...keyHint("m", "read"));
  kids.push(...keyHint("a", "all read"), ...keyHint("o", "Slack"), ...keyHint("p", "pal"));
  return row(kids, { key: "hints", gap: 1, minHeight: 22 });
}

export function actions(st: BarState): Action[] {
  const cur = st.rows[st.focus];
  /** What a click reaches: a row (the cursor), a quiet channel's badge (opens it). */
  const clicks: Action[] = [
    ...st.rows.map((r): Action => ({ id: `focus:${r.id}`, title: `Go to ${r.where}`, hidden: true })),
    ...st.quiet.slice(0, QUIET_SHOWN).map((c): Action => ({ id: `open:${c.id}`, title: `Open ${c.name}`, hidden: true })),
  ];
  if (st.replying) return [{ id: "send", title: "Send" }, { id: "cancel", title: "Cancel reply" }, ...clicks];
  return [
    { id: "open", title: cur ? `Open ${cur.where} in Slack` : "Open Slack" },
    ...(cur?.canReply ? [{ id: "reply", title: `Reply to ${cur.where}`, shortcut: "r" }] : []),
    ...(cur?.canRead ? [{ id: "read", title: `Mark ${cur.where} read`, shortcut: "m" }] : []),
    { id: "read-all", title: "Mark all read", shortcut: ["a", "cmd+shift+a"], style: "destructive" },
    { id: "open-slack", title: "Open Slack", shortcut: "o" },
    { id: "open-pal", title: "Open in pal", shortcut: "p" },
    { id: "browser", title: "Open in browser", shortcut: "cmd+shift+o" },
    { id: "copy", title: "Copy link", shortcut: "cmd+c" },
    { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
    ...clicks,
  ];
}

export function render(st: BarState): View {
  const counts = (["dm", "mention", "thread"] as const).map((k) => [k, st.rows.filter((r) => r.kind === k).length] as const).filter(([, n]) => n);
  let tree: ViewNode;
  if (!st.rows.length) {
    tree = column(
      [
        { type: "tile", key: "zero", width: 48, height: 48, text: "✓", color: "green", fill: "soft" },
        text("Inbox zero", { style: "title", key: "zero-t" }),
        text(st.quietTotal ? `Nothing addressed to you; ${st.quietTotal} ${st.quietTotal === 1 ? "channel is" : "channels are"} unread` : "Nothing addressed to you and every channel is read", { style: "muted", size: "sm", align: "center" }),
        ...quietRow(st),
        row([...keyHint("o", "Slack"), ...keyHint("p", "pal")], { key: "hints", gap: 1, minHeight: 22 }),
      ],
      { key: "compact", padding: 3, gap: 2, align: "center" },
    );
  } else {
    let offset = 0;
    const sections: ViewNode[] = [];
    for (const kind of ["dm", "mention", "thread"] as const) {
      const of = st.rows.filter((r) => r.kind === kind);
      sections.push(...section(kind, of, st, offset));
      offset += of.length;
    }
    tree = column([...sections, ...quietRow(st), hints(st, st.rows[st.focus])], { key: "compact", padding: 3, gap: 2 });
  }
  const title = st.replying ? `Reply to ${st.rows.find((r) => r.id === st.replying)?.where ?? "Slack"}` : counts.length ? counts.map(([k, n]) => `${n} ${k === "dm" ? (n === 1 ? "DM" : "DMs") : k === "mention" ? (n === 1 ? "mention" : "mentions") : n === 1 ? "thread" : "threads"}`).join(" · ") : "Slack";
  const cur = st.rows.find((r) => r.id === st.replying);
  return {
    tree,
    actions: actions(st),
    title,
    id: "inbox",
    keys: "actions",
    ...(st.replying && { input: { value: st.draft ?? "", placeholder: cur ? `Reply to ${cur.where}` : "Reply", submit: "send", cancel: "cancel" } }),
  };
}
