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
  | { date: string | number | Date };

/** "cmd+shift+c", "ctrl+n", "enter", "cmd+enter". Lower-case, "+" joined. */
export type Shortcut = string;

export type Action = {
  id: string;
  title: string;
  icon?: Icon;
  shortcut?: Shortcut;
  /** Actions are primary/secondary by position (first two); this only marks danger. */
  style?: "destructive";
  /** Ask first: the question, with the action's title as the go-ahead. */
  confirm?: string;
  section?: string;
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

export type FormField =
  | { kind: "text"; id: string; label: string; placeholder?: string; value?: string }
  | { kind: "textarea"; id: string; label: string; placeholder?: string; value?: string }
  | { kind: "select"; id: string; label: string; options: FilterOption[]; value?: string }
  | { kind: "checkbox"; id: string; label: string; text?: string; value?: boolean };

export type FormValues = Record<string, string | boolean>;
