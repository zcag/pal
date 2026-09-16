import { createContext, useContext, useEffect, useImperativeHandle, useLayoutEffect, useReducer, useRef, type CSSProperties, type Ref } from "react";
import { Kbd } from "./Kbd";
import { Tag } from "./Row";
import { Presence, reduced } from "./presence";
import type { ViewNode } from "./types";

/** What an `image` node may load: the app's icon scheme, or a picture the extension made (an SVG data url). Anything else is not shown. */
const IMAGE_SRC = /^(icon:\/\/|data:image\/)/;
/** `Transition.delay` steps, at most. */
const MAX_DELAY = 8;
/** A colour of the extension's own on a tile or a gradient stop (`HexColor`): `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
export const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const TAG_COLORS = new Set(["grey", "blue", "green", "amber", "red", "violet", "pink", "teal", "neutral", "accent"]);

/** `#rgb[a]` / `#rrggbb[aa]` as channels 0..255 and alpha 0..1; undefined for anything else. */
export function parseHex(hex: unknown): { r: number; g: number; b: number; a: number } | undefined {
  if (typeof hex !== "string" || !HEX_COLOR.test(hex)) return;
  const s = hex.slice(1);
  const full = s.length <= 4 ? [...s].map((c) => c + c).join("") : s;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
}

/**
 * Black or white ink on a colour, by WCAG contrast: white once the
 * colour's relative luminance is under 0.179, where the two ratios meet.
 */
export function inkOn(hex: string): "#000" | "#fff" {
  const c = parseHex(hex);
  if (!c) return "#fff";
  const lin = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const l = 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  return l > 0.179 ? "#000" : "#fff";
}

const SIDES = { right: "to right", left: "to left", down: "to bottom", up: "to top" } as const;
/**
 * The `background` of a gradient node: its layers as CSS linear gradients
 * in paint order (the first at the bottom, the last on top; CSS lists the
 * topmost first, hence the reverse) over the `fill` colour when there is
 * one. Stops may carry alpha (`#ffffff00`), which is what makes the
 * classic plane: a white-to-transparent layer rightwards and a
 * black-to-transparent layer upwards over the hue as the fill.
 */
export function gradientCss(layers: { stops: string[]; direction?: string }[], fill?: unknown): string {
  const parts = layers
    .filter((l) => l && Array.isArray(l.stops) && l.stops.filter((c) => HEX_COLOR.test(String(c))).length >= 2)
    .map((l) => `linear-gradient(${SIDES[(l.direction ?? "right") as keyof typeof SIDES] ?? SIDES.right}, ${l.stops.filter((c) => HEX_COLOR.test(String(c))).join(", ")})`)
    .reverse();
  if (typeof fill === "string" && HEX_COLOR.test(fill)) parts.push(fill);
  return parts.join(", ");
}

/**
 * Where the moving nodes of one view are (`Transition.move`): the element
 * under each key, its last box, and the keys that move in the tree being
 * drawn. `boxes` is measured before a new tree commits, so a node that
 * mounts elsewhere (another cell, another parent) can slide from where its
 * key was; `moving` tells a stack that a gone key has not left but moved,
 * so it draws no exit for it.
 */
type Moves = { els: Map<string, HTMLElement>; boxes: Map<string, DOMRect>; anims: Map<string, Animation>; moving: Set<string>; /** Bumped per new tree: a node measures and moves once per tree, not on every re-render (a busy flag flipping must not cut a slide short). */ gen: number };
const MoveContext = createContext<Moves | null>(null);

const ms = (v: string) => (v.trim().endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000) || 0;

/** Keys of the nodes in `tree` that carry `transition.move`. */
function movingKeys(tree: ViewNode, into = new Set<string>()): Set<string> {
  if (tree && typeof tree === "object") {
    if (tree.transition?.move && typeof tree.key === "string") into.add(tree.key);
    if (tree.type === "stack" && Array.isArray(tree.children)) for (const c of tree.children) movingKeys(c, into);
  }
  return into;
}

/**
 * A render tree (`ViewNode`, mirrored from sdk/src/protocol.ts) drawn with
 * the tokens: a fixed vocabulary of stacks, text, images, tiles, badges,
 * dividers, spacers, progress bars, gradients and key caps, never HTML. A node of a
 * type this build does not know is skipped, not thrown on, so a newer
 * extension still draws the rest. Keyed children of a stack animate in and
 * out per their `transition`: a new key enters (fade, a slide, flip, pop),
 * a gone key stays for its exit under the presence wrapper, a kept key
 * keeps its DOM, and a `move` key found at another box in the previous
 * tree slides from there (a FLIP: measured before the commit, animated
 * after it, `--pal-motion-move`).
 */
export function View({ tree, label, autoFocus, rootRef }: { tree: ViewNode; label?: string; /** Take focus on mount: the level has no input, so the document itself is what the keys and a screen reader land on. */ autoFocus?: boolean; /** The document element, for a caller that hands focus back to it (after a `View.input` field closes). */ rootRef?: Ref<HTMLDivElement> }) {
  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(rootRef, () => root.current as HTMLDivElement, []);
  useEffect(() => { if (autoFocus) root.current?.focus({ preventScroll: true }); }, [autoFocus]);
  const moves = useRef<Moves>({ els: new Map(), boxes: new Map(), anims: new Map(), moving: new Set(), gen: 0 }).current;
  const last = useRef<ViewNode | null>(null);
  if (last.current !== tree) {
    // Before the commit, with the old tree still in the DOM: where every moving node is now, transform and all, so the slide starts from what is on screen. Boxes of keys not in the new tree are dropped.
    moves.moving = movingKeys(tree);
    for (const [k, el] of moves.els) if (moves.moving.has(k)) moves.boxes.set(k, el.getBoundingClientRect());
    for (const k of [...moves.boxes.keys()]) if (!moves.moving.has(k)) moves.boxes.delete(k);
    moves.gen++;
    last.current = tree;
  }
  return (
    <div ref={root} className="pal-view" role="document" aria-label={label} tabIndex={autoFocus ? -1 : undefined}>
      <MoveContext.Provider value={moves}>
        <Node node={tree} />
      </MoveContext.Provider>
    </div>
  );
}

/**
 * The FLIP for a `move` node: after every commit the node's box is
 * recorded; on the commit where its key was measured at another box (the
 * node re-mounted elsewhere, or its stack re-laid it) the node is played
 * from that box to its own with a transform, over `--pal-motion-move`.
 * A re-mounted mover skips its `enter` animation, since a slide is what
 * it does. Nothing under reduced motion, or without a key.
 */
function useMove(key: string | undefined, move: boolean | undefined): Ref<HTMLElement> {
  const moves = useContext(MoveContext);
  const ref = useRef<HTMLElement | null>(null);
  const fresh = useRef(true);
  const seen = useRef(-1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!moves || !el || typeof key !== "string" || !move) return;
    moves.els.set(key, el);
    const unregister = () => { if (moves.els.get(key) === el) moves.els.delete(key); };
    if (seen.current === moves.gen) return unregister;
    seen.current = moves.gen;
    const from = moves.boxes.get(key);
    moves.anims.get(key)?.cancel();
    const box = el.getBoundingClientRect();
    moves.boxes.set(key, box);
    if (from && !reduced()) {
      const dx = from.left - box.left, dy = from.top - box.top;
      if (fresh.current) el.style.animation = "none";
      const style = getComputedStyle(el);
      const dur = ms(style.getPropertyValue("--pal-motion-move"));
      if ((dx || dy) && dur > 0) {
        const a = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: dur, easing: style.getPropertyValue("--pal-ease").trim() || "ease" });
        moves.anims.set(key, a);
        a.finished.then(() => { if (moves.anims.get(key) === a) moves.anims.delete(key); }, () => {});
      }
    }
    fresh.current = false;
    return unregister;
  });
  return ref as Ref<HTMLElement>;
}

const space = (n: number | undefined) => (n ? `var(--pal-space-${Math.min(6, Math.max(1, Math.floor(n)))})` : undefined);
const px = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined);

/**
 * A tile's type: the size scales with the box and shrinks for a longer
 * text (a 64 px tile shows "2" at 28 px and "2048" at 19), heavy once it
 * is large. `sub` takes a fixed small size.
 */
function tileType(width: number, height: number, text: string, sub: boolean): CSSProperties {
  const fit = Math.min(height * (sub ? 0.34 : 0.44), (width * 0.82) / Math.max(1, text.length * 0.62));
  const size = Math.max(9, Math.round(fit));
  return { fontSize: size, fontWeight: size >= 20 ? 800 : size >= 14 ? 700 : 600, letterSpacing: size >= 20 ? "-0.02em" : undefined };
}

/** Fired on the node's element when a keyed node mounts (`detail` is the key): a kept key never fires again, which is what a tracer of an in-place update counts (core.ts). */
export const MOUNT_EVENT = "pal:view-mount";

function Node({ node }: { node: ViewNode }) {
  const t = node.transition;
  const delay = t?.delay ? Math.min(MAX_DELAY, Math.max(0, Math.floor(t.delay))) : 0;
  const ref = useMove(node.key, t?.move);
  const key = typeof node.key === "string" ? node.key : undefined;
  useEffect(() => { if (key !== undefined) (ref as { current: HTMLElement | null }).current?.dispatchEvent(new CustomEvent(MOUNT_EVENT, { bubbles: true, detail: key })); }, []);
  const motion: { ref: Ref<never>; "data-enter"?: string; style?: CSSProperties } = {
    ref: ref as Ref<never>,
    "data-enter": t?.enter,
    style: delay ? { animationDelay: `calc(var(--pal-dur-fast, 80ms) * ${delay})` } : undefined,
  };
  switch (node.type) {
    case "stack":
      return (
        <div
          className="pal-view__node pal-view__stack"
          data-direction={node.direction === "row" ? "row" : undefined}
          data-align={node.align}
          data-justify={node.justify}
          data-grow={node.grow || undefined}
          data-surface={node.surface}
          data-radius={node.radius || undefined}
          {...motion}
          style={{ ...motion.style, gap: space(node.gap), padding: space(node.padding), minHeight: node.minHeight }}
        >
          <Children nodes={Array.isArray(node.children) ? node.children : []} />
        </div>
      );
    case "text": {
      const width = px(node.width), minWidth = px(node.minWidth);
      return (
        <span
          className="pal-view__node pal-view__text"
          data-style={node.style}
          data-weight={node.weight}
          data-size={node.size}
          data-color={node.color}
          data-align={node.align}
          {...motion}
          style={{ ...motion.style, ...(width !== undefined ? { flex: "none", width } : undefined), ...(minWidth !== undefined ? { minWidth } : undefined) }}
        >
          {String(node.value ?? "")}
        </span>
      );
    }
    case "image":
      if (typeof node.src !== "string" || !IMAGE_SRC.test(node.src)) return null;
      return <img className="pal-view__node pal-view__image" src={node.src} width={node.width} height={node.height} data-mask={node.mask} alt={node.alt ?? ""} decoding="async" draggable={false} {...motion} />;
    case "tile": {
      const width = px(node.width) ?? 0, height = px(node.height) ?? 0;
      const text = node.text === undefined || node.text === null ? "" : String(node.text);
      const sub = node.sub === undefined || node.sub === null ? "" : String(node.sub);
      // A hex colour of the extension's own: the box is that colour, the ink black or white by contrast, a checker under a translucent one. Anything else the tokens draw (an unknown name falls back to neutral).
      const own = typeof node.color === "string" && !TAG_COLORS.has(node.color) ? parseHex(node.color) : undefined;
      const color = own ? "custom" : TAG_COLORS.has(String(node.color)) ? node.color : "neutral";
      const ownStyle: CSSProperties | undefined = own ? ({ "--tile": node.color, "--tile-ink": inkOn(node.color as string) } as CSSProperties) : undefined;
      return (
        <div className="pal-view__node pal-view__tile" data-color={color} data-fill={node.fill ?? "soft"} data-alpha={own && own.a < 1 ? "" : undefined} data-small={Math.min(width, height) < 44 || undefined} {...motion} style={{ ...motion.style, ...ownStyle, width, height }}>
          {text && <span className="pal-view__tile-text" style={tileType(width, height, text, !!sub)}>{text}</span>}
          {sub && <span className="pal-view__tile-sub">{sub}</span>}
        </div>
      );
    }
    case "gradient": {
      const width = px(node.width) ?? 0, height = px(node.height) ?? 0;
      const background = gradientCss(Array.isArray(node.layers) ? node.layers : [], node.fill);
      const m = node.marker && typeof node.marker === "object" ? node.marker : undefined;
      const unit = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);
      const mx = unit(m?.x), my = unit(m?.y);
      return (
        <div className="pal-view__node pal-view__gradient" role="img" {...motion} style={{ ...motion.style, width, height, background: background || undefined }}>
          {mx !== undefined && my !== undefined && <span className="pal-view__marker" aria-hidden style={{ left: `${mx * 100}%`, top: `${my * 100}%` }} />}
        </div>
      );
    }
    case "badge":
      return <Tag className="pal-view__node" text={String(node.text ?? "")} color={node.color} {...motion} />;
    case "divider":
      return <hr className="pal-view__node pal-view__divider" {...motion} />;
    case "spacer":
      return <span className="pal-view__node pal-view__spacer" aria-hidden {...motion} style={{ ...motion.style, ...(node.size ? { flex: "none", width: node.size, height: node.size } : undefined) }} />;
    case "progress": {
      const pct = Math.round(Math.min(1, Math.max(0, Number(node.value) || 0)) * 100);
      return (
        <div className="pal-view__node pal-view__progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} data-color={node.color} {...motion} style={{ ...motion.style, ...(node.width ? { flex: "none", width: node.width } : undefined) }}>
          <span style={{ width: `${pct}%` }} />
        </div>
      );
    }
    case "keycap":
      return <Kbd className="pal-view__node" shortcut={String(node.keys ?? "")} {...motion} />;
    default:
      return null;
  }
}

type Slot = { node: ViewNode; alive: boolean };

/**
 * A stack's children with exits. A keyed child whose key is in the previous
 * tree but not this one is kept at its old position, exiting, until the
 * presence wrapper says it is done (unless its `exit` is `none`, or it is a
 * `move` key still in the tree elsewhere: it moved, it did not leave); a
 * key that comes back while leaving is simply alive again. Unkeyed children
 * are matched by position and go at once. The bookkeeping lives in refs and
 * is recomputed in render, which is idempotent for one `nodes` value, so a
 * strict-mode double render sees the same answer.
 */
function Children({ nodes }: { nodes: ViewNode[] }) {
  const moves = useContext(MoveContext);
  const last = useRef(nodes);
  const leaving = useRef(new Map<string, { node: ViewNode; index: number }>());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  if (last.current !== nodes) {
    const now = new Set(nodes.map((n) => n.key).filter((k): k is string => typeof k === "string"));
    last.current.forEach((n, index) => {
      if (n.key && !now.has(n.key) && n.transition?.exit !== "none" && !(n.transition?.move && moves?.moving.has(n.key))) leaving.current.set(n.key, { node: n, index });
    });
    for (const k of now) leaving.current.delete(k);
    last.current = nodes;
  }
  const slots: Slot[] = nodes.map((node) => ({ node, alive: true }));
  for (const l of [...leaving.current.values()].sort((a, b) => a.index - b.index)) slots.splice(Math.min(l.index, slots.length), 0, { node: l.node, alive: false });
  let unkeyed = 0;
  return (
    <>
      {slots.map((s) => {
        const key = s.node.key;
        if (typeof key !== "string") return <Node key={`\u0000${unkeyed++}`} node={s.node} />;
        const gone = () => { if (leaving.current.delete(key)) bump(); };
        return (
          <Presence key={key} show={s.alive} dur="fast" onExited={gone}>
            <Node node={s.node} />
          </Presence>
        );
      })}
    </>
  );
}
