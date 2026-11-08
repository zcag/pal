/** What the layers need of `window.history`: an entry on top, and a step back over several. */
export type Entries = { push(): void; go(delta: number): void };

/**
 * The page's layers (levels, a sheet) kept as browser history entries, one
 * each, so the browser's back pops one: `sync` with the count the page has
 * now (an entry pushed per new layer, the surplus walked back over when the
 * page dropped some itself), `popped` on every `popstate`, true when it was
 * the person's back and the page should drop a layer (false for the page's
 * own walk back).
 */
export function historyLayers(entries: Entries) {
  let depth = 0, walking = 0;
  return {
    sync(layers: number) {
      if (layers > depth) { for (; depth < layers; depth++) entries.push(); return; }
      if (layers === depth) return;
      walking++;
      entries.go(layers - depth);
      depth = layers;
    },
    popped(): boolean {
      if (walking) { walking--; return false; }
      if (!depth) return false;
      depth--;
      return true;
    },
  };
}
