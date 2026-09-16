import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SettingsDiagnostics } from "./SettingsDiagnostics";
import type { Diagnostic, SettingsIndexEntry, SettingsPage } from "./SettingsTypes";

/* The tab icons: 18px line drawings on the toolbar, one per page. */
const icons: Record<SettingsPage, ReactNode> = {
  general: <svg viewBox="0 0 18 18"><path d="M3 5h12M3 9h12M3 13h12" /><circle cx="6.5" cy="5" r="1.6" /><circle cx="11.5" cy="9" r="1.6" /><circle cx="7.5" cy="13" r="1.6" /></svg>,
  palettes: <svg viewBox="0 0 18 18"><rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1.2" /><rect x="10" y="2.5" width="5.5" height="5.5" rx="1.2" /><rect x="2.5" y="10" width="5.5" height="5.5" rx="1.2" /><rect x="10" y="10" width="5.5" height="5.5" rx="1.2" /></svg>,
  extensions: <svg viewBox="0 0 18 18"><path d="M9 2.2l5.9 3.4v6.8L9 15.8l-5.9-3.4V5.6z" /><path d="M9 9l5.9-3.4M9 9v6.8M9 9L3.1 5.6" /></svg>,
  about: <svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" /><path d="M9 8v4.5" /><circle cx="9" cy="5.6" r="0.5" fill="currentColor" /></svg>,
};

export const settingsPages: { id: SettingsPage; title: string }[] = [
  { id: "general", title: "General" },
  { id: "palettes", title: "Palettes" },
  { id: "extensions", title: "Extensions" },
  { id: "about", title: "About" },
];

export type SettingsWindowProps = {
  page: SettingsPage;
  onPage: (page: SettingsPage) => void;
  /** Under the page: a count, the last error. */
  aside?: ReactNode;
  /** Every setting on every page, for the search field. */
  index?: SettingsIndexEntry[];
  onJump?: (entry: SettingsIndexEntry) => void;
  diagnostics?: Diagnostic[];
  file?: string;
  onOpenDiagnostic?: (d: Diagnostic) => void;
  /** macOS: the toolbar starts after the traffic lights, which sit inside it (the title bar is ours). */
  mac?: boolean;
  children: ReactNode;
};

/**
 * The settings window, shaped like a macOS preferences window: a toolbar
 * band with the pages as icon tabs across the top, the page below it at a
 * reading measure, nothing else. The search field on the toolbar's right
 * finds a setting on any page; typing puts the hits where the page was.
 */
export function SettingsWindow({ page, onPage, aside, index = [], onJump, diagnostics = [], file, onOpenDiagnostic, mac, children }: SettingsWindowProps) {
  const [query, setQuery] = useState("");
  const tabs = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const hits = q ? index.filter((e) => `${e.label} ${e.hint ?? ""} ${e.page}`.toLowerCase().includes(q)).slice(0, 20) : [];
  const current = settingsPages.find((p) => p.id === page)!;

  const focusIn = (root: HTMLElement | null, e: KeyboardEvent, dir: 1 | -1) => {
    const items = [...(root?.querySelectorAll<HTMLElement>("[data-nav]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + dir + items.length) % items.length];
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    next.focus();
    return next;
  };
  /** Enter and Space activate the focused item here, so an outer key scope never sees them. */
  const activate = (e: KeyboardEvent, fn: () => void) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  const onTabsKey = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir) {
      const next = focusIn(tabs.current, e, dir);
      if (next) onPage(next.dataset.nav as SettingsPage);
    } else if (e.key === "Home" || e.key === "End") {
      const items = tabs.current?.querySelectorAll<HTMLElement>("[data-nav]");
      const el = items && items[e.key === "Home" ? 0 : items.length - 1];
      if (el) { e.preventDefault(); e.stopPropagation(); el.focus(); onPage(el.dataset.nav as SettingsPage); }
    }
  };
  const onResultsKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") focusIn(results.current, e, 1);
    else if (e.key === "ArrowUp") focusIn(results.current, e, -1);
  };
  const jump = (h: SettingsIndexEntry) => { onPage(h.page); onJump?.(h); setQuery(""); };

  return (
    <div className="pal-settings" data-keyscope data-mac={mac || undefined}>
      <header className="pal-settings__toolbar" data-tauri-drag-region>
        <span className="pal-settings__lights" aria-hidden data-tauri-drag-region />
        <nav className="pal-settings__tabs" role="tablist" aria-label="Settings pages" ref={tabs} onKeyDown={onTabsKey} data-tauri-drag-region>
          {settingsPages.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === page}
              aria-controls={`pal-settings-${p.id}`}
              data-nav={p.id}
              tabIndex={p.id === page ? 0 : -1}
              className="pal-settings__tab"
              data-active={p.id === page || undefined}
              onClick={() => onPage(p.id)}
              onKeyDown={(e) => activate(e, () => onPage(p.id))}
            >
              <span className="pal-settings__tab-icon" aria-hidden>{icons[p.id]}</span>
              <span className="pal-settings__tab-label">{p.title}</span>
            </button>
          ))}
        </nav>
        <div className="pal-settings__search" data-tauri-drag-region>
          <label className="pal-settings__search-field">
            <span className="pal-settings__search-glyph" aria-hidden>
              <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2L14 14" /></svg>
            </span>
            <input
              className="pal-settings__search-input"
              type="search"
              placeholder="Search"
              value={query}
              spellCheck={false}
              autoComplete="off"
              aria-label="Search settings"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) { e.stopPropagation(); setQuery(""); }
                if (e.key === "ArrowDown") focusIn(results.current, e, 1);
                if (e.key === "Enter" && hits[0]) { e.preventDefault(); jump(hits[0]); }
              }}
            />
          </label>
        </div>
      </header>

      <div className="pal-settings__content" id={`pal-settings-${page}`} role="tabpanel" aria-label={current.title}>
        {q ? (
          <div className="pal-settings__body">
            <div className="pal-settings-page pal-settings__results" role="listbox" aria-label="Matching settings" ref={results} onKeyDown={onResultsKey}>
              {hits.length === 0 && <p className="pal-settings__none">Nothing matches "{query}"</p>}
              {hits.length > 0 && <div className="pal-settings__results-list">{hits.map((h, i) => (
                <button
                  key={`${h.page}-${h.label}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  data-nav={h.page}
                  className="pal-settings__result"
                  tabIndex={i === 0 ? 0 : -1}
                  onClick={() => jump(h)}
                  onKeyDown={(e) => activate(e, () => jump(h))}
                >
                  <span className="pal-settings__result-label">{h.label}</span>
                  <span className="pal-settings__result-hint">{h.hint ?? settingsPages.find((p) => p.id === h.page)?.title}</span>
                  <span className="pal-settings__result-page">{settingsPages.find((p) => p.id === h.page)?.title}</span>
                </button>
              ))}</div>}
            </div>
          </div>
        ) : (
          <div className="pal-settings__body">{children}</div>
        )}
        {aside && <div className="pal-settings__aside">{aside}</div>}
        {diagnostics.length > 0 && (
          <div className="pal-settings__footer">
            <SettingsDiagnostics diagnostics={diagnostics} file={file} onOpen={onOpenDiagnostic} />
          </div>
        )}
      </div>
    </div>
  );
}
