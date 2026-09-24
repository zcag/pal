// A game surface at its smallest (docs/design/game-surface.md): the view is
// one `surface` node, a page of this folder's own (surface/index.html) that
// draws and takes the keys; the extension keeps what outlives the page.
// The page reaches it with `pal.send` (answered by `onMessage`), and it
// reaches the page with `surface.post`. The view's actions go to the page
// (`pal.onAction`), not to `pick`.
import { defineExtension, storage, surface, view } from "@zcag/pal";

const PALETTE = "dot";
const best = async () => (await storage.get<number>("best")) ?? null;

// Whenever the level comes up, the page hears the best so far.
view.onShown(async (ev) => {
  if (ev.palette === PALETTE) await surface.post({ best: await best() });
});

export default defineExtension({
  palettes: {
    [PALETTE]: {
      title: "Dot",
      icon: "🟣",
      view: () => ({
        title: "Dot",
        tree: { type: "surface", src: "surface/index.html" },
        actions: [
          { id: "centre", title: "Back to the centre", shortcut: "cmd+r" },
          { id: "reset", title: "Forget the best", confirm: "Forget the best run?", style: "destructive" },
        ],
      }),
      pick: () => {},
      // `{ reached: steps }` from the page: the best is kept here, and the reply says what it is now.
      onMessage: async (msg) => {
        const m = msg as { reached?: number; reset?: boolean };
        if (m.reset) return storage.set("best", null).then(() => ({ best: null }));
        const was = await best();
        const steps = Number(m.reached);
        if (!Number.isFinite(steps)) throw new Error("reached: not a number");
        if (was === null || steps < was) await storage.set("best", steps);
        return { best: was === null ? steps : Math.min(was, steps) };
      },
    },
  },
});
