import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { keepFocus } from "./keys";
import type { Arg, Filter, Icon as IconSpec, Shortcut } from "./types";

/** The focused row's typed arguments (`Item.args`), drawn after the query: a field each, `invalid` the required ones left empty on the last run, `firstRef` the first field (Tab from the query lands there), `onEscape` back to the query. */
export type SearchArgs = { fields: Arg[]; values: Record<string, string>; invalid: Set<string>; onChange: (id: string, value: string) => void; firstRef: RefObject<HTMLInputElement | HTMLSelectElement | null>; onEscape: () => void };

/** Keys inside an argument field: Escape goes back to the query; Enter, cmd+Enter, the up/down arrows and the launcher's cmd combos reach the page (they run the row, move the cursor, open the panel); everything else is the field's own (typing, Tab between fields, cmd+a/c/v/x, word deletes). */
const EDIT_COMBOS = new Set(["a", "c", "v", "x", "z", "Backspace", "ArrowLeft", "ArrowRight"]);
const onArgKey = (e: KeyboardEvent, onEscape: () => void) => {
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onEscape(); return; }
  const cmd = e.metaKey || e.ctrlKey;
  if (e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown" || (cmd && !EDIT_COMBOS.has(e.key))) return;
  e.stopPropagation();
};

export type SearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Shown when a level is pushed: a back chevron and the level's title; without `onBack` (a bottom level with nothing under it) the title alone. */
  back?: { title: string; icon?: IconSpec; onBack?: () => void };
  filter?: Filter;
  /** The listbox (or grid) this input drives, for aria-controls / aria-activedescendant. */
  listId?: string;
  activeId?: string;
  /** What `listId` is; a Grid says "grid". */
  popup?: "listbox" | "grid";
  loading?: boolean;
  /** A level with nothing to search (a detail-only view): the input stays for focus, but takes no text and shows no caret. */
  readOnly?: boolean;
  /** A level with no input at all (a view level): this title stands where the input would, as a navigation title. */
  title?: string;
  /** Compact mode: the footer's primary action hint ("Open ↵") on the row's right side, since there is no footer; `onHint` runs it on a click. */
  hint?: { title: string; shortcut?: Shortcut };
  onHint?: () => void;
  /** Compact mode: the marked-rows count, where the footer would show it. */
  count?: number;
  /** The focused row's typed arguments, as fields after the query. */
  args?: SearchArgs;
};

export function Search({ value, onChange, placeholder = "Search…", inputRef, back, filter, listId, activeId, popup = "listbox", loading, readOnly, title, hint, onHint, count, args }: SearchProps) {
  return (
    <div className="pal-search" data-loading={loading || undefined} data-readonly={readOnly || undefined} aria-busy={loading || undefined}>
      {back && (back.onBack ? (
        <button type="button" className="pal-search__back" onClick={back.onBack} onMouseDown={keepFocus} aria-label={`Back from ${back.title}`} tabIndex={-1}>
          <span className="pal-search__chevron" aria-hidden>‹</span>
          {back.icon && <Icon icon={back.icon} size="sm" />}
          <span className="pal-search__crumb">{back.title}</span>
        </button>
      ) : (
        <span className="pal-search__back" data-static="" role="heading" aria-level={1}>
          {back.icon && <Icon icon={back.icon} size="sm" />}
          <span className="pal-search__crumb">{back.title}</span>
        </span>
      ))}
      {title !== undefined ? <span className="pal-search__title" role="heading" aria-level={1}>{title}</span> : <input
        ref={inputRef}
        className="pal-search__input"
        type="text"
        role="combobox"
        aria-expanded={!!listId}
        aria-haspopup={popup}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onKeyDown={args ? (e) => { if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); args.firstRef.current?.focus({ preventScroll: true }); } } : undefined}
      />}
      {args && (
        <div className="pal-args" role="group" aria-label="Arguments" onKeyDown={(e) => onArgKey(e, args.onEscape)}>
          {args.fields.map((f, i) => {
            const common = { name: f.id, "aria-label": f.placeholder, "aria-invalid": args.invalid.has(f.id) || undefined, "aria-required": f.required || undefined, "data-invalid": args.invalid.has(f.id) ? "" : undefined, className: "pal-args__field" };
            return f.kind === "select" ? (
              <select key={f.id} {...common} ref={i === 0 ? (args.firstRef as RefObject<HTMLSelectElement | null>) : undefined} value={args.values[f.id] ?? ""} onChange={(e) => args.onChange(f.id, e.target.value)}>
                {(f.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>
            ) : (
              <input key={f.id} {...common} ref={i === 0 ? (args.firstRef as RefObject<HTMLInputElement | null>) : undefined} type="text" inputMode={f.kind === "number" ? "decimal" : undefined} placeholder={f.placeholder} value={args.values[f.id] ?? ""} onChange={(e) => args.onChange(f.id, e.target.value)} spellCheck={false} autoComplete="off" size={Math.max(6, Math.min(24, f.placeholder.length + 2))} />
            );
          })}
        </div>
      )}
      {filter && (
        <label className="pal-search__filter">
          <select value={filter.value} onChange={(e) => filter.onChange(e.target.value)} aria-label="Filter" tabIndex={-1}>
            {filter.options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
          <span className="pal-search__chevron" aria-hidden>⌄</span>
        </label>
      )}
      {!!count && <span className="pal-footer__count pal-search__count" aria-live="polite">{count} selected</span>}
      {hint && (
        <button type="button" className="pal-footer__hint pal-search__hint" onClick={onHint} onMouseDown={keepFocus} tabIndex={-1}>
          {hint.title} <Kbd shortcut={hint.shortcut ?? "enter"} />
        </button>
      )}
    </div>
  );
}
