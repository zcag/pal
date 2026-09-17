// The Latest code popover as a tree (`View` in `@zcag/pal`), pure (the
// bar-shot fixture renders a state with this same function). 420 px wide:
// the newest code as a row of digit tiles (grouped in threes, as a form
// shows it) with the sender, when it arrived and the message under it,
// then a thin amber bar counting down the minute the item stays for
// (ticking while the popover shows), the keys as hints, and the two codes
// before it small under a hairline. A click on the code or a row copies
// that code (concealed, as the palette does).
import { POPOVER_W, column, keyHint, oneLine, row, text, type Action, type View, type ViewNode } from "@zcag/pal";

/** One code as the reader found it (index.ts `Code`, the fields the view draws). */
export type ShownCode = { id: string; code: string; name: string; sender: string; text: string; at: number };
export type OtpState = {
  /** The newest code, still inside the window; none when the item is hidden (the tree then says so). */
  latest?: ShownCode;
  /** The codes before it, newest first; the first two are drawn. */
  previous: ShownCode[];
  /** The moment drawn (`Date.now()`). */
  now: number;
  /** How long a code stays on the strip after it arrived, ms. */
  window: number;
};

/** Codes drawn under the newest one. */
export const PREVIOUS = 2;
const DIGIT_H = 52;
/** nf-md-message_text, the extension's own mark, drawn as a glyph text when there is no code to show. */
const MESSAGE = "\u{f0369}";

const hint = (keys: string[], what: string, action: string): ViewNode[] => keyHint(keys, what, { action });

/** `just now`, `23 s ago`, `5 min ago`, `2 h ago`. */
export const ago = (at: number, now: number): string => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
};

/** The digits in groups: threes for six (and nine), fours for four and eight, halves otherwise; a code with letters is one group. */
export function groups(code: string): string[] {
  if (!/^\d+$/.test(code)) return [code];
  const n = code.length;
  const size = n % 3 === 0 ? 3 : n % 4 === 0 ? 4 : Math.ceil(n / 2);
  const out: string[] = [];
  for (let i = 0; i < n; i += size) out.push(code.slice(i, i + size));
  return out;
}

/** The code as digit tiles, a wider gap between groups; the whole row copies on a click. */
function digits(code: string): ViewNode {
  const gs = groups(code);
  const n = code.length;
  const w = n > 6 ? 40 : 44;
  const kids: ViewNode[] = [];
  gs.forEach((g, gi) => {
    if (gi) kids.push({ type: "spacer", key: `gap-${gi}`, size: 8 });
    [...g].forEach((ch, i) => kids.push({ type: "tile", key: `d-${gi}-${i}`, width: w, height: DIGIT_H, text: ch, color: "green", fill: "soft", transition: { enter: "pop", delay: gi * g.length + i } }));
  });
  return row(kids, { key: `digits-${code}`, gap: 1, action: "copy" });
}

function latest(st: OtpState): ViewNode {
  const c = st.latest!;
  const left = Math.max(0, st.window - (st.now - c.at));
  return column(
    [
      digits(c.code),
      row([text(c.name, { key: "from", size: "sm", weight: "semibold" }), text(ago(c.at, st.now), { key: "when", style: "muted", size: "xs" })], { key: "sender", gap: 2, minHeight: 18 }),
      text(oneLine(c.text), { key: "text", style: "muted", size: "xs", width: POPOVER_W }),
      row([{ type: "progress", key: "left", value: st.window > 0 ? left / st.window : 0, color: "amber" }, text(`${Math.ceil(left / 1000)}s`, { key: "left-s", style: "mono", size: "xs", color: "muted", width: 28, align: "end" })], { key: "countdown", gap: 2 }),
    ],
    { key: `latest-${c.id}`, gap: 1, transition: { enter: "fade" } },
  );
}

function hints(): ViewNode {
  return row([...hint(["enter"], "copy", "copy"), ...hint(["p"], "paste", "paste"), ...hint(["s"], "copy sender", "copy-sender"), ...hint(["o"], "all codes", "open")], { key: "hints", gap: 1, minHeight: 22 });
}

/** The codes before the newest: the code in green mono, the sender, when; a click copies that one. */
function earlier(st: OtpState): ViewNode[] {
  const list = st.previous.slice(0, PREVIOUS);
  if (!list.length) return [];
  return [
    { type: "divider", key: "rule" },
    text("Earlier", { key: "earlier", size: "xs", weight: "semibold", color: "muted" }),
    ...list.map((c): ViewNode => row(
      [text(c.code, { key: "code", style: "mono", size: "sm", weight: "semibold", color: "green", width: 84 }), text(c.name, { key: "name", size: "sm", width: 200 }), { type: "spacer", key: "sp" }, text(ago(c.at, st.now), { key: "when", style: "muted", size: "xs" })],
      { key: `prev-${c.id}`, gap: 2, minHeight: 22, action: `copy:${c.id}` },
    )),
  ];
}

function none(): ViewNode {
  return column(
    [text(MESSAGE, { key: "none-mark", style: "glyph", size: "xl", color: "faint" }), text("No recent code", { style: "title", size: "lg" }), text("The newest code stays here for a minute after it arrives", { style: "muted", size: "sm", align: "center" })],
    { key: "none", padding: 6, gap: 2, align: "center", justify: "center" },
  );
}

/** Every action the popover answers to; the first listed is Enter. The earlier rows' copies are hidden, reached by a click. */
export function actions(st: OtpState): Action[] {
  if (!st.latest) return [{ id: "open", title: "All codes", shortcut: "o" }];
  return [
    { id: "copy", title: "Copy code", shortcut: ["c", "cmd+c"] },
    { id: "paste", title: "Paste code", shortcut: "p" },
    { id: "copy-sender", title: "Copy sender", shortcut: ["s", "cmd+shift+c"] },
    { id: "open", title: "All codes", shortcut: "o" },
    ...st.previous.slice(0, PREVIOUS).map((c): Action => ({ id: `copy:${c.id}`, title: `Copy ${c.code} from ${c.name}`, hidden: true })),
  ];
}

export function render(st: OtpState): View {
  const tree = st.latest ? column([latest(st), hints(), ...earlier(st)], { key: "compact", padding: 3, gap: 2 }) : none();
  return { tree, actions: actions(st), title: st.latest ? `${st.latest.code} from ${st.latest.name}` : "Latest code", id: "latest", keys: "actions" };
}
