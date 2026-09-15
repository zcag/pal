import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import { SettingsDiagnostics } from "./SettingsDiagnostics";
import type { Diagnostic, SettingsIndexEntry, SettingsPage } from "./SettingsTypes";
import type { Icon as IconSpec } from "./types";

export const settingsPages: { id: SettingsPage; title: string; icon: IconSpec }[] = [
  { id: "general", title: "General", icon: { kind: "glyph", value: "◐" } },
  { id: "palettes", title: "Palettes", icon: { kind: "glyph", value: "▤" } },
  { id: "extensions", title: "Extensions", icon: { kind: "glyph", value: "⬡" } },
];

export type SettingsWindowProps = {
  page: SettingsPage;
  onPage: (page: SettingsPage) => void;
  /** Title over the content; the page's name when absent. */
  title?: string;
  /** Right side of the title bar: a count, a button. */
  aside?: ReactNode;
  /** Every setting on every page, for the search field. */
  index?: SettingsIndexEntry[];
  onJump?: (entry: SettingsIndexEntry) => void;
  diagnostics?: Diagnostic[];
  file?: string;
  onOpenDiagnostic?: (d: Diagnostic) => void;
  version?: string;
  children: ReactNode;
};

/**
 * The settings window: its own window, larger than the panel. A sidebar
 * with a search field over every setting and the pages, and the page on
 * the right under a title bar. Config-file problems sit under the page.
 */
export function SettingsWindow({ page, onPage, title, aside, index = [], onJump, diagnostics = [], file, onOpenDiagnostic, version, children }: SettingsWindowProps) {
  const [query, setQuery] = useState("");
  const nav = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const hits = q ? index.filter((e) => `${e.label} ${e.hint ?? ""} ${e.page}`.toLowerCase().includes(q)).slice(0, 12) : [];
  const current = settingsPages.find((p) => p.id === page)!;

  const moveIn = (e: KeyboardEvent, dir: 1 | -1) => {
    const items = [...(nav.current?.querySelectorAll<HTMLElement>("[data-nav]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + dir + items.length) % items.length];
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    next.focus();
    if (!q) onPage(next.dataset.nav as SettingsPage);
  };
  /** Enter and Space activate the focused item here, so an outer key scope never sees them. */
  const activate = (e: KeyboardEvent, fn: () => void) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  const onNavKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") moveIn(e, 1);
    else if (e.key === "ArrowUp") moveIn(e, -1);
    else if (e.key === "Home" || e.key === "End") {
      const items = nav.current?.querySelectorAll<HTMLElement>("[data-nav]");
      const el = items && items[e.key === "Home" ? 0 : items.length - 1];
      if (el) { e.preventDefault(); e.stopPropagation(); el.focus(); if (!q) onPage(el.dataset.nav as SettingsPage); }
    }
  };

  return (
    <div className="pal-settings" data-keyscope>
      <aside className="pal-settings__nav" ref={nav} onKeyDown={onNavKey}>
        <div className="pal-settings__search">
          <span className="pal-settings__search-glyph" aria-hidden>⌕</span>
          <input
            className="pal-settings__search-input"
            type="search"
            placeholder="Search settings"
            value={query}
            spellCheck={false}
            autoComplete="off"
            aria-label="Search settings"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && query) { e.stopPropagation(); setQuery(""); } if (e.key === "ArrowDown") moveIn(e, 1); }}
          />
        </div>
        {q ? (
          <div className="pal-settings__results" role="listbox" aria-label="Matching settings">
            {hits.length === 0 && <p className="pal-settings__none">Nothing matches "{query}"</p>}
            {hits.map((h, i) => (
              <button
                key={`${h.page}-${h.label}-${i}`}
                type="button"
                role="option"
                aria-selected={false}
                data-nav={h.page}
                className="pal-settings__result"
                tabIndex={i === 0 ? 0 : -1}
                onClick={() => { onPage(h.page); onJump?.(h); setQuery(""); }}
                onKeyDown={(e) => activate(e, () => { onPage(h.page); onJump?.(h); setQuery(""); })}
              >
                <span className="pal-settings__result-label">{h.label}</span>
                <span className="pal-settings__result-hint">{h.hint ?? settingsPages.find((p) => p.id === h.page)?.title}</span>
              </button>
            ))}
          </div>
        ) : (
          <nav className="pal-settings__pages" role="tablist" aria-label="Settings pages" aria-orientation="vertical">
            {settingsPages.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === page}
                aria-controls={`pal-settings-${p.id}`}
                data-nav={p.id}
                tabIndex={p.id === page ? 0 : -1}
                className="pal-settings__page"
                data-active={p.id === page || undefined}
                onClick={() => onPage(p.id)}
                onKeyDown={(e) => activate(e, () => onPage(p.id))}
              >
                <Icon icon={p.icon} />
                <span>{p.title}</span>
              </button>
            ))}
          </nav>
        )}
        {version && <div className="pal-settings__version">pal {version}</div>}
      </aside>
      <div className="pal-settings__content" id={`pal-settings-${page}`} role="tabpanel" aria-label={title ?? current.title}>
        <header className="pal-settings__title">
          <h2 className="pal-settings__heading">{title ?? current.title}</h2>
          {aside && <div className="pal-settings__aside">{aside}</div>}
        </header>
        <div className="pal-settings__body">{children}</div>
        {diagnostics.length > 0 && (
          <div className="pal-settings__footer">
            <SettingsDiagnostics diagnostics={diagnostics} file={file} onOpen={onOpenDiagnostic} />
          </div>
        )}
      </div>
    </div>
  );
}
