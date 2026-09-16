import { useEffect, useReducer, useRef, type CSSProperties } from "react";
import { Kbd } from "./Kbd";
import { Tag } from "./Row";
import { Presence } from "./presence";
import type { ViewNode } from "./types";

/** What an `image` node may load: the app's icon scheme, or a picture the extension made (an SVG data url). Anything else is not shown. */
const IMAGE_SRC = /^(icon:\/\/|data:image\/)/;
/** `Transition.delay` steps, at most. */
const MAX_DELAY = 8;

/**
 * A render tree (`ViewNode`, mirrored from sdk/src/protocol.ts) drawn with
 * the tokens: a fixed vocabulary of stacks, text, images, badges, dividers,
 * spacers, progress bars and key caps, never HTML. A node of a type this
 * build does not know is skipped, not thrown on, so a newer extension still
 * draws the rest. Keyed children of a stack animate in and out per their
 * `transition`: a new key enters (fade, slide-up, flip), a gone key stays
 * for its exit under the presence wrapper, a kept key keeps its DOM.
 */
export function View({ tree, label, autoFocus }: { tree: ViewNode; label?: string; /** Take focus on mount: the level has no input, so the document itself is what the keys and a screen reader land on. */ autoFocus?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (autoFocus) root.current?.focus({ preventScroll: true }); }, [autoFocus]);
  return (
    <div ref={root} className="pal-view" role="document" aria-label={label} tabIndex={autoFocus ? -1 : undefined}>
      <Node node={tree} />
    </div>
  );
}

const space = (n: number | undefined) => (n ? `var(--pal-space-${Math.min(6, Math.max(1, Math.floor(n)))})` : undefined);

function Node({ node }: { node: ViewNode }) {
  const t = node.transition;
  const delay = t?.delay ? Math.min(MAX_DELAY, Math.max(0, Math.floor(t.delay))) : 0;
  const motion: { "data-enter"?: string; style?: CSSProperties } = {
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
          {...motion}
          style={{ ...motion.style, gap: space(node.gap), padding: space(node.padding), minHeight: node.minHeight }}
        >
          <Children nodes={Array.isArray(node.children) ? node.children : []} />
        </div>
      );
    case "text":
      return (
        <span className="pal-view__node pal-view__text" data-style={node.style} data-weight={node.weight} data-size={node.size} data-color={node.color} {...motion}>
          {String(node.value ?? "")}
        </span>
      );
    case "image":
      if (typeof node.src !== "string" || !IMAGE_SRC.test(node.src)) return null;
      return <img className="pal-view__node pal-view__image" src={node.src} width={node.width} height={node.height} data-mask={node.mask} alt={node.alt ?? ""} decoding="async" draggable={false} {...motion} />;
    case "badge":
      return <Tag className="pal-view__node" text={String(node.text ?? "")} color={node.color} {...motion} />;
    case "divider":
      return <hr className="pal-view__node pal-view__divider" {...motion} />;
    case "spacer":
      return <span className="pal-view__node pal-view__spacer" aria-hidden {...motion} style={{ ...motion.style, ...(node.size ? { flex: "none", width: node.size, height: node.size } : undefined) }} />;
    case "progress": {
      const pct = Math.round(Math.min(1, Math.max(0, Number(node.value) || 0)) * 100);
      return (
        <div className="pal-view__node pal-view__progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} {...motion} style={{ ...motion.style, ...(node.width ? { flex: "none", width: node.width } : undefined) }}>
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
 * presence wrapper says it is done (unless its `exit` is `none`); a key
 * that comes back while leaving is simply alive again. Unkeyed children
 * are matched by position and go at once. The bookkeeping lives in refs and
 * is recomputed in render, which is idempotent for one `nodes` value, so a
 * strict-mode double render sees the same answer.
 */
function Children({ nodes }: { nodes: ViewNode[] }) {
  const last = useRef(nodes);
  const leaving = useRef(new Map<string, { node: ViewNode; index: number }>());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  if (last.current !== nodes) {
    const now = new Set(nodes.map((n) => n.key).filter((k): k is string => typeof k === "string"));
    last.current.forEach((n, index) => {
      if (n.key && !now.has(n.key) && n.transition?.exit !== "none") leaving.current.set(n.key, { node: n, index });
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
