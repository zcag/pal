import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { barKey, Launcher, menuLevel, type LauncherHandle, type Level } from "./Launcher";
import { menuKind, type BarPayload, type BarShow } from "./bar";
import { mark, surface, useCore, useLiveViews } from "./core";
import { sourceKey, staysOpen, toView, type Ctx, type Effect } from "./items";
import type { Item } from "./ui/types";

const hide = () => invoke("bar_hide");

/** `index.html?bar&sidebar`: the sidebar's window (sidebar.rs), the same page with the rows numbered and cmd+N a pick. */
const sidebar = new URLSearchParams(location.search).has("sidebar");

/** The popover's height for what it shows: the search row, the footer and the content, up to the window's maximum (bar/popover.rs clamps too; the sidebar's is its work area, sidebar.rs). */
const MAX_HEIGHT = sidebar ? Infinity : 480;
const CHROME = 52 + 36;

/**
 * The level a bar item opens on: its `nodes` as a menu level, `{ palette }`
 * as that palette level (`args` as for `Effect.push`), `{ view }` as a view
 * level; an `effect` from `bar/open` (a `push`, `view` or `show`) instead
 * when the click had no menu. An item with nothing to show gets an empty
 * menu level carrying its title.
 */
function levelOf(p: BarShow): Level {
  const ext = p.key.split("/")[0];
  const e = p.effect;
  if (e?.push) return { kind: "palette", palette: sourceKey(e.push), args: e.push.args };
  if (e?.view) return { kind: "view", palette: barKey(p.key), title: p.title, spec: toView(e.view) };
  if (e?.show) return { kind: "show", detail: { markdown: e.show.markdown, metadata: e.show.metadata }, title: e.show.title };
  const m = p.menu;
  switch (menuKind(m)) {
    case "nodes": return menuLevel(p.key, p.title, m as Extract<typeof m, unknown[]>);
    case "palette": { const pm = m as { palette: string; extension?: string; args?: unknown }; return { kind: "palette", palette: `${pm.extension ?? ext}/${pm.palette}`, args: pm.args }; }
    case "view": return { kind: "view", palette: barKey(p.key), title: p.title, spec: toView((m as { view: never }).view) };
    default: return menuLevel(p.key, p.title, []);
  }
}

/**
 * The `bar` window's page (`index.html?bar`): the Launcher on one level,
 * no root, for the bar item the shell names on `pal://bar` (bar/popover.rs).
 * Escape hides it, the whole grammar applies; a pick on a menu row or a
 * view action is `bar/action` on the item, a pick in a palette level the
 * usual one. The window follows the content's height.
 *
 * The `sidebar` window (`?bar&sidebar`) is this page too: its level is
 * the configured palette (the payload's `menu`), every row wears its
 * number and cmd+N runs it (`Launcher.ordinals`), a click into a peek
 * engages it (`bar_engage`), and the same commands reach sidebar.rs by
 * the window's label.
 */
export default function BarPage() {
  const core = useCore(hide);
  const launcher = useRef<LauncherHandle>(null);
  const [show, setShow] = useState<BarShow | null>(null);
  const showing = useRef<BarShow | null>(null);
  const page = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Named to this window: a listener on the default target (`Any`) hears every window's, and the sidebar's show would start a level in the popover too (core.ts does the same for `pal://view`).
    const un = listen<BarPayload>("pal://bar", (e) => {
      const p = e.payload;
      if ("hide" in p) { showing.current = null; setShow(null); return; }
      if ("engage" in p) { if (showing.current) { showing.current.engaged = true; setShow({ ...showing.current }); } (page.current?.querySelector(".pal-search__input") as HTMLInputElement | null)?.focus(); return; }
      // The same item rendered again while showing: its level is replaced in place; another item starts over.
      // One line in the log per show: which item, peek or engaged, and whether its level is replaced in place (a lost show is otherwise invisible in a release build).
      mark(`bar show ${p.key} ${p.engaged ? "engaged" : "peek"}${showing.current?.key === p.key ? " again" : ""}`, 0);
      const inPlace = showing.current?.key === p.key && menuKind(showing.current.menu) === menuKind(p.menu) && !!showing.current.effect === !!p.effect;
      showing.current = p;
      setShow(p);
      launcher.current?.start(levelOf(p), inPlace);
      if (inPlace && menuKind(p.menu) === "palette") core.bump();
    }, { target: getCurrentWindow().label });
    return () => {
      un.then((f) => f());
    };
  }, [core.bump]);

  // The window's height follows the content: the list's virtual height, or a view, a show, a form.
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const inner = el.querySelector<HTMLElement>(".pal-list__inner, .pal-view > .pal-view__stack, .pal-show, .pal-form-level, .pal-empty");
      const content = inner ? inner.scrollHeight + 16 : 120;
      // The chrome as drawn: the sidebar hides its field while peeking and has no footer, so the popover's fixed sum would leave a gap.
      const chrome = sidebar ? (el.querySelector<HTMLElement>(".pal-panel__search")?.offsetHeight ?? 0) + (el.querySelector<HTMLElement>(".pal-footer")?.offsetHeight ?? 0) : CHROME;
      invoke("bar_size", { height: Math.min(MAX_HEIGHT, chrome + content) });
    };
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(measure); });
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    measure();
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  // Live views in the popover: the same push, trigger and on-top report as the panel's (views.rs marks them `compact`).
  const viewOpen = useLiveViews(launcher);

  // A click into a peeking sidebar engages it (the popover's peek engages from its item, never from here).
  const engage = useCallback(() => { if (sidebar && showing.current && !showing.current.engaged) { showing.current.engaged = true; setShow({ ...showing.current }); invoke("bar_engage"); } }, []);

  // A row of the item's own level (a menu row, a view action, a form's submit) is `bar/action`; a palette level's rows are the usual pick.
  const pick = useCallback(async (item: Item, query: string, action?: string, ctx?: Ctx) => {
    const key = showing.current?.key;
    if (item.source || !key || (item.palette !== key && item.palette !== barKey(key))) return core.pick(item, query, action, ctx);
    const t0 = performance.now();
    // What a control read rides along (`ctx.values` in the extension's `onAction`): the text field on Enter, a form's fields, a slider's fraction.
    const r = await invoke<Effect>("bar_action", { key, action: action ?? item.id, values: ctx?.values ?? null });
    mark(`bar action ${key} ${action ?? item.id} ms`, performance.now() - t0);
    if (!staysOpen(r)) hide();
    return r;
  }, [core.pick]);

  // cmd+r on the item's level renders the item again; inside a palette level it is that palette's refresh.
  const refresh = useCallback((scope?: { extension: string; palette: string }) => {
    if (scope) return core.refresh(scope as never);
    if (showing.current) invoke("bar_refresh", { key: showing.current.key });
  }, [core.refresh]);

  return (
    <div ref={page} className="pal-bar-page" data-urgent={show?.urgent || undefined} data-sidebar={sidebar || undefined} data-peek={sidebar && show && !show.engaged ? "" : undefined} title={show?.tooltip} onMouseDownCapture={engage}>
      <Launcher ref={launcher} sources={core.sources} search={core.search} detail={core.detail} view={core.view} version={core.version} mark={mark} start={menuLevel("pal/none", "pal", [])} onHide={hide} onPick={pick} onRefresh={refresh} onViewOpen={viewOpen} surface={surface} ordinals={sidebar} />
    </div>
  );
}
