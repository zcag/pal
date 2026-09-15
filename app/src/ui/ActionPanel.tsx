import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Fzf } from "fzf";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { Highlight } from "./Row";
import { useCursor } from "./cursor";
import { useKeys } from "./keys";
import { flatten } from "./virtual";
import type { Action } from "./types";

export type ActionPanelProps = {
  actions: Action[];
  onRun: (action: Action) => void;
  onClose: () => void;
  title?: string;
};

/** Implied shortcut for the first two actions, unless one is declared. */
export const actionShortcut = (a: Action, index: number) => a.shortcut ?? (index === 0 ? "enter" : index === 1 ? "cmd+enter" : undefined);

/**
 * Overlay anchored bottom-right. Owns its own search and cursor and swallows
 * the keys it handles, so the launcher behind it stays put.
 */
export function ActionPanel({ actions, onRun, onClose, title }: ActionPanelProps) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const fzf = useMemo(() => new Fzf(actions, { selector: (a) => a.title }), [actions]);
  const hits = useMemo(
    () => (query ? fzf.find(query).map((r) => ({ action: r.item, positions: r.positions })) : actions.map((action) => ({ action, positions: undefined }))),
    [fzf, actions, query],
  );
  const cur = useCursor(hits.length);
  const { rows } = useMemo(() => flatten(hits.map((h) => ({ ...h, section: h.action.section }))), [hits]);
  const mouse = useRef({ x: 0, y: 0 });

  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  useEffect(() => cur.reset(), [query, cur.reset]);
  // Keep the selected row inside the list without scrolling any ancestor.
  useEffect(() => {
    const list = root.current?.querySelector<HTMLElement>(".pal-actions__list");
    const row = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop, bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [cur.cursor]);

  const run = (a: Action) => onRun(a);
  useKeys(
    {
      move: ({ dir }) => (dir === "up" || dir === "down" ? cur.move(dir === "down" ? 1 : -1) : false),
      jump: ({ to }) => cur.set(to === "home" || to === "pageUp" ? 0 : cur.last),
      primary: () => { const h = hits[cur.cursor]; if (h) run(h.action); },
      escape: onClose,
      actions: onClose,
      back: () => (query ? false : onClose()),
      shortcut: ({ combo }) => { const a = actions.find((x) => x.shortcut === combo); return a ? run(a) : false; },
    },
    { scope: root },
  );

  const hover = (index: number) => (e: MouseEvent) => {
    const m = mouse.current;
    if (e.clientX === m.x && e.clientY === m.y) return;
    m.x = e.clientX; m.y = e.clientY;
    cur.set(index);
  };

  return (
    <>
      <div className="pal-scrim" onClick={onClose} aria-hidden />
      <div ref={root} className="pal-actions" role="dialog" aria-label={title ? `Actions for ${title}` : "Actions"} data-keyscope>
      <div className="pal-actions__list" role="listbox" aria-activedescendant={hits.length ? `action-${cur.cursor}` : undefined}>
        {title && <div className="pal-actions__title">{title}</div>}
        {rows.map((row, r) => {
          if (row.kind === "header") return <div key={`h${r}`} className="pal-section pal-actions__section" role="presentation">{row.title}</div>;
          const i = row.index;
          const { action, positions } = row.items[0];
          const shortcut = actionShortcut(action, actions.indexOf(action));
          return (
            <div key={i} id={`action-${i}`} role="option" aria-selected={i === cur.cursor} className="pal-action" data-active={i === cur.cursor || undefined} data-style={action.style} onMouseMove={hover(i)} onClick={() => run(action)}>
              <Icon icon={action.icon} size="sm" />
              <span className="pal-action__title"><Highlight text={action.title} positions={positions} /></span>
              {shortcut && <Kbd shortcut={shortcut} />}
            </div>
          );
        })}
        {!hits.length && <div className="pal-actions__none">No matching actions</div>}
      </div>
        <input ref={input} className="pal-actions__search" type="text" placeholder="Search for actions…" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} autoComplete="off" aria-label="Search actions" />
      </div>
    </>
  );
}
