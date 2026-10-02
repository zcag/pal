import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Fzf } from "fzf";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { Highlight } from "./Row";
import { graphemePositions } from "./format";
import { useCursor } from "./cursor";
import { hasShortcut, keepFocus, shortcutsOf, useKeys } from "./keys";
import { flatten, useHover } from "./virtual";
import type { Action } from "./types";

export type ActionPanelProps = {
  actions: Action[];
  onRun: (action: Action) => void;
  onClose: () => void;
  title?: string;
};

/** The listed action's first key, or the implied one for the first two listed (Enter, ⌘Enter), unless declared. */
export const actionShortcut = (a: Action, index: number) => shortcutsOf(a)[0] ?? (index === 0 ? "enter" : index === 1 ? "cmd+enter" : undefined);

/**
 * Overlay anchored bottom-right. Owns its own search and cursor and swallows
 * every command, so the launcher behind it stays put; only what its field
 * needs natively (caret keys, cmd+backspace) is left to the field. A
 * `hidden` action is not listed (its key still runs it from here).
 */
export function ActionPanel({ actions: all, onRun, onClose, title }: ActionPanelProps) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const uid = useId();
  const [query, setQuery] = useState("");
  const actions = useMemo(() => all.filter((a) => !a.hidden), [all]);
  const fzf = useMemo(() => new Fzf(actions, { selector: (a) => a.title }), [actions]);
  const hits = useMemo(
    () => (query ? fzf.find(query).map((r) => ({ action: r.item, positions: graphemePositions(r.item.title, r.positions) })) : actions.map((action) => ({ action, positions: undefined }))),
    [fzf, actions, query],
  );
  const cur = useCursor(hits.length);
  const { rows } = useMemo(() => flatten(hits.map((h) => ({ ...h, section: h.action.section }))), [hits]);
  const { hover, hovered } = useHover(cur.cursor, cur.set);
  const optionId = (i: number) => `${uid}-${i}`;

  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  useEffect(() => cur.reset(), [query, cur.reset]);
  // Keep the selected row inside the list without scrolling any ancestor; a hover never scrolls.
  useEffect(() => {
    if (hovered()) return;
    const list = root.current?.querySelector<HTMLElement>(".pal-actions__list");
    const row = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop, bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [cur.cursor, hovered]);

  const run = (a: Action) => onRun(a);
  /**
   * Left/Right in a sheet of columns (`--pal-actions-cols`): the action in
   * the next column over whose middle is nearest the cursor's; false when
   * there is no column that way (one column, or the edge), so the key stays
   * the field's.
   */
  const across = (way: 1 | -1): boolean => {
    const opts = [...(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = opts[cur.cursor];
    if (!at) return false;
    const r = at.getBoundingClientRect(), mid = r.top + r.height / 2;
    const others = opts.map((o, i) => ({ i, b: o.getBoundingClientRect() })).filter(({ b }) => (way > 0 ? b.left >= r.right - 1 : b.right <= r.left + 1));
    if (!others.length) return false;
    const col = way > 0 ? Math.min(...others.map((o) => o.b.left)) : Math.max(...others.map((o) => o.b.left));
    const best = others.filter((o) => Math.abs(o.b.left - col) < 1).sort((a, b) => Math.abs(a.b.top + a.b.height / 2 - mid) - Math.abs(b.b.top + b.b.height / 2 - mid))[0];
    cur.set(best.i);
    return true;
  };
  // The rows as blocks, a section's header with its actions: a sheet of columns keeps each block whole.
  const groups = useMemo(() => {
    const out: { header?: string; rows: typeof rows }[] = [];
    for (const row of rows) {
      if (row.kind === "header") out.push({ header: row.title, rows: [] });
      else (out[out.length - 1] ?? (out.push({ rows: [] }), out[0])).rows.push(row);
    }
    return out;
  }, [rows]);
  const swallow = () => {};
  useKeys(
    {
      move: ({ dir }) => (dir === "up" || dir === "down" ? cur.move(dir === "down" ? 1 : -1) : !query && across(dir === "right" ? 1 : -1) ? undefined : "native"),
      jump: ({ to }) => cur.set(to === "home" || to === "pageUp" ? 0 : cur.last),
      jumpTo: swallow,
      primary: () => { const h = hits[cur.cursor]; if (h) run(h.action); },
      secondary: swallow,
      escape: onClose,
      actions: onClose,
      back: () => (query ? "native" : onClose()),
      filter: swallow,
      detail: swallow,
      shortcut: ({ combo }) => { const a = all.find((x) => hasShortcut(x, combo)); if (a) run(a); },
      // Typing into the panel's own field; never a bare-key action of the level behind.
      key: () => "native",
    },
    { scope: root, modal: true },
  );

  return (
    <>
      <div className="pal-scrim" onClick={onClose} aria-hidden />
      <div ref={root} className="pal-actions" role="dialog" aria-label={title ? `Actions for ${title}` : "Actions"} data-keyscope onMouseDown={keepFocus}>
        <div id={`${uid}-list`} className="pal-actions__list" role="listbox" aria-label="Actions">
          {title && <div className="pal-actions__title">{title}</div>}
          <div className="pal-actions__cols">
          {groups.map((g, gi) => (
          <div key={gi} className="pal-actions__group" role="presentation">
          {g.header && <div className="pal-section pal-actions__section" role="presentation">{g.header}</div>}
          {g.rows.map((row) => {
            if (row.kind === "header") return null;
            const i = row.index;
            const { action, positions } = row.items[0];
            const shortcut = actionShortcut(action, actions.indexOf(action));
            const alternatives = shortcutsOf(action).slice(1);
            return (
              <div key={action.id} id={optionId(i)} role="option" aria-selected={i === cur.cursor} className="pal-action" data-active={i === cur.cursor || undefined} data-style={action.style} onMouseMove={hover(i)} onClick={() => run(action)}>
                <Icon icon={action.icon} size="sm" />
                <span className="pal-action__title"><Highlight text={action.title} positions={positions} /></span>
                {alternatives.map((k) => <Kbd key={k} shortcut={k} className="pal-action__alt" />)}
                {shortcut && <Kbd shortcut={shortcut} />}
              </div>
            );
          })}
          </div>
          ))}
          </div>
          {!hits.length && <div className="pal-actions__none" role="status">No matching actions</div>}
        </div>
        <input
          ref={input}
          className="pal-actions__search"
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={`${uid}-list`}
          aria-activedescendant={hits.length ? optionId(cur.cursor) : undefined}
          aria-autocomplete="list"
          aria-label="Search actions"
          placeholder="Search for actions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    </>
  );
}
