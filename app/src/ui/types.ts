/**
 * Working item model for the UI. Close to what v1 palettes emit (see
 * fixtures/all.jsonl) plus what the components need. Not the final contract.
 */

export type IconMask = "circle" | "rounded";

export type Icon =
  /** Drawn in the platform's colour emoji font. */
  | { kind: "emoji"; value: string }
  /** Text in the mono font, or a Nerd Font codepoint in the bundled symbols font; `color` tints it. */
  | { kind: "glyph"; value: string; color?: string }
  | { kind: "image"; src: string; mask?: IconMask }
  /** An application's own artwork via the `icon://` scheme; `letter` when it has none. */
  | { kind: "app"; path: string; letter: string }
  /** The site's favicon via the `icon://` scheme; the globe glyph when it has none. */
  | { kind: "favicon"; url: string };

export type Accessory =
  | { text: string }
  | { tag: string; color?: string }
  | { date: string | number | Date }
  /** A shortcut as key caps (a menu row's). */
  | { keys: Shortcut };

/** "cmd+shift+c", "ctrl+n", "enter", "cmd+enter". Lower-case, "+" joined. */
export type Shortcut = string;

export type Action = {
  id: string;
  title: string;
  icon?: Icon;
  /** One key, or alternatives (`["up", "k"]`): any runs it, the panel draws the first and the rest faintly. `shortcutsOf` (keys.ts) reads either. */
  shortcut?: Shortcut | Shortcut[];
  /** Actions are primary/secondary by position (first two listed); this only marks danger. */
  style?: "destructive";
  /** Ask first: the question, with the action's title as the go-ahead. */
  confirm?: string;
  section?: string;
  /** Routes its key, is never listed (not in the panel, the footer, nor the Enter / ⌘Enter pair). */
  hidden?: true;
};

export type Metadata = {
  label: string;
  value?: string;
  tags?: { text: string; color?: string }[];
  link?: { text: string; href: string };
};

export type Detail = {
  markdown?: string;
  metadata?: Metadata[];
};

export type Item = {
  id: string;
  name: string;
  subtitle?: string;
  icon?: Icon;
  keywords?: string[];
  palette?: string;
  /** Which extension palette listed it; what a pick is addressed to. */
  source?: { extension: string; palette: string };
  section?: string;
  accessories?: Accessory[];
  detail?: Detail;
  /** `detail` is what came inline; the rest is asked for when the pane rests on the item. */
  lazyDetail?: boolean;
  actions?: Action[];
  /** Drawn greyed; a pick on it does nothing (a menu row). */
  disabled?: boolean;
  /** Drawn muted but live: the "N more in ..." row after a capped section at the root. */
  muted?: boolean;
};

/** Match positions per field, as fzf reports them (character indexes). */
export type Match = {
  name?: Set<number>;
  subtitle?: Set<number>;
};

export type FilterOption = { id: string; title: string };

export type Filter = {
  options: FilterOption[];
  value: string;
  onChange: (id: string) => void;
};

/**
 * One form field (`FormField` in sdk/src/protocol.ts, with `default`
 * named `value` here). `required` blocks the submit while empty (unticked
 * for a checkbox), `description` is a help line under the field.
 */
export type FormField = { id: string; label: string; placeholder?: string; required?: boolean; description?: string } & (
  | { kind: "text"; value?: string }
  | { kind: "textarea"; value?: string }
  | { kind: "password"; value?: string }
  | { kind: "select"; options: FilterOption[]; value?: string }
  | { kind: "checkbox"; text?: string; value?: boolean }
);

export type FormValues = Record<string, string | boolean>;

/** A form level (`Form` in sdk/src/protocol.ts): the submit is a pick with `submit.id` and the values; `errors` by field id come from the extension. */
export type FormSpec = { id?: string; title: string; fields: FormField[]; submit: { id: string; title: string }; cancel?: string; errors?: Record<string, string> };

// ---- view: a declarative render tree ------------------------------------
// Mirrors `ViewNode` / `View` in sdk/src/protocol.ts (the contract); this
// side only adds nothing. Unknown node types are skipped by the renderer.

export type TagColor = "grey" | "blue" | "green" | "amber" | "red" | "violet" | "pink" | "teal";

/** `enter` on a new key, `exit` on a gone one, `delay` in steps of `--pal-dur-fast`, `move` slides a key found at another box in the previous tree. */
export type Transition = { enter?: "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "flip" | "pop"; exit?: "fade" | "none"; delay?: number; move?: true };

type NodeBase = { key?: string; transition?: Transition };

/** Steps of the 4 px grid, `--pal-space-N`. */
export type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ViewNode =
  | (NodeBase & { type: "stack"; direction?: "row" | "column"; gap?: Space; padding?: Space; align?: "start" | "center" | "end" | "stretch"; justify?: "start" | "center" | "end" | "between"; grow?: boolean; minHeight?: number; surface?: "sunken" | "elevated"; radius?: boolean; children: ViewNode[] })
  | (NodeBase & { type: "text"; value: string; style?: "title" | "body" | "muted" | "mono" | "number"; weight?: "regular" | "medium" | "semibold"; size?: "xs" | "sm" | "md" | "lg" | "xl"; color?: TagColor | "accent" | "success" | "destructive" | "muted" | "faint"; width?: number; minWidth?: number; align?: "start" | "center" | "end" })
  | (NodeBase & { type: "image"; src: string; width?: number; height?: number; mask?: IconMask; alt?: string })
  | (NodeBase & { type: "tile"; width: number; height: number; text?: string; sub?: string; color?: TagColor | "neutral" | "accent"; fill?: "solid" | "soft" | "outline" })
  | (NodeBase & { type: "badge"; text: string; color?: TagColor })
  | (NodeBase & { type: "divider" })
  | (NodeBase & { type: "spacer"; size?: number })
  | (NodeBase & { type: "progress"; value: number; width?: number; color?: TagColor })
  | (NodeBase & { type: "keycap"; keys: string });

/** A view level: the tree, its actions (first is Enter), an optional title over the tree; `keys: "actions"` maps bare keys to actions. */
export type ViewSpec = { tree: ViewNode; actions: Action[]; title?: string; id?: string; keys?: "actions" };
