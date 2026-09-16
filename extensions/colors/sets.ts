// The named sets the grid lists: which exist, in what order, how a row's
// token is spelled and where it is used. The hex tables of the sets that
// are fetched (Tailwind, Material, Material 3, Catppuccin) live in
// data.json (build.ts); the four small hand-kept ones (Apple, Rosé Pine,
// Nord, Solarized) are here, since their sources are pages, not packages.

/** One row of data.json: `id` unique across sets (`<set>/<token>`), `n` the name shown, `h` the hex, `s` the set id, `v` the variant (a theme flavour, light/dark) when the set has them. */
export type Row = { id: string; n: string; h: string; s: SetId; v?: string };

export type SetId = "css" | "pal" | "tailwind" | "material" | "material3" | "apple" | "catppuccin" | "rosepine" | "nord" | "solarized";
export type SetInfo = { id: SetId; title: string; /** The set's own name for a swatch's token, for the Copy name action. */ token: string; /** The source, for the README. */ source: string };

/** Every set, in the grid's order; `sets` in the settings names them by id. */
export const SETS: SetInfo[] = [
  { id: "css", title: "CSS", token: "name", source: "CSS Color 4 named colours" },
  { id: "tailwind", title: "Tailwind", token: "class", source: "tailwindcss 3.4 default palette" },
  { id: "material3", title: "Material 3", token: "tone", source: "the M3 baseline tonal palettes, generated from the seed #6750A4 with material-color-utilities" },
  { id: "material", title: "Material", token: "shade", source: "the 2014 Material palette (material-colors)" },
  { id: "apple", title: "Apple", token: "system colour", source: "the Human Interface Guidelines' system colours, light and dark" },
  { id: "catppuccin", title: "Catppuccin", token: "colour", source: "catppuccin/palette 1.8 (Latte, Frappé, Macchiato, Mocha)" },
  { id: "rosepine", title: "Rosé Pine", token: "colour", source: "rosé pine's palette (Main, Moon, Dawn)" },
  { id: "nord", title: "Nord", token: "colour", source: "the Nord palette (Polar Night, Snow Storm, Frost, Aurora)" },
  { id: "solarized", title: "Solarized", token: "colour", source: "Ethan Schoonover's Solarized" },
  { id: "pal", title: "pal tokens", token: "token", source: "pal's own tokens.css, light and dark" },
];
export const SET_IDS = SETS.map((s) => s.id);
export const setInfo = (id: SetId): SetInfo => SETS.find((s) => s.id === id)!;

/** The token as it is spelled where it is used: `slate-500`, `aliceblue`, `primary-40`, `systemBlue`, `mocha/blue`, `--pal-accent`. */
export function token(r: Row): string {
  const t = r.id.slice(r.id.indexOf("/") + 1);
  switch (r.s) {
    case "pal": return `--pal-${t.replace(/^(light|dark)\//, "")}`;
    case "apple": return `system${cap(t.replace(/^(light|dark)\//, ""))}`;
    default: return t;
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The section the row lists under: the set's title, with the variant for a set that has them (`Catppuccin Mocha`, `Apple dark`). */
export const sectionOf = (r: Row): string => (r.v ? `${setInfo(r.s).title} ${r.s === "apple" || r.s === "pal" ? r.v : cap(r.v)}` : setInfo(r.s).title);

// ---- the hand-kept sets --------------------------------------------------------

const APPLE_LIGHT: Record<string, string> = { red: "#ff3b30", orange: "#ff9500", yellow: "#ffcc00", green: "#34c759", mint: "#00c7be", teal: "#30b0c7", cyan: "#32ade6", blue: "#007aff", indigo: "#5856d6", purple: "#af52de", pink: "#ff2d55", brown: "#a2845e", gray: "#8e8e93", gray2: "#aeaeb2", gray3: "#c7c7cc", gray4: "#d1d1d6", gray5: "#e5e5ea", gray6: "#f2f2f7" };
const APPLE_DARK: Record<string, string> = { red: "#ff453a", orange: "#ff9f0a", yellow: "#ffd60a", green: "#30d158", mint: "#63e6e2", teal: "#40c8e0", cyan: "#64d2ff", blue: "#0a84ff", indigo: "#5e5ce6", purple: "#bf5af2", pink: "#ff375f", brown: "#ac8e68", gray: "#8e8e93", gray2: "#636366", gray3: "#48484a", gray4: "#3a3a3c", gray5: "#2c2c2e", gray6: "#1c1c1e" };

const ROSE_PINE: Record<string, Record<string, string>> = {
  main: { base: "#191724", surface: "#1f1d2e", overlay: "#26233a", muted: "#6e6a86", subtle: "#908caa", text: "#e0def4", love: "#eb6f92", gold: "#f6c177", rose: "#ebbcba", pine: "#31748f", foam: "#9ccfd8", iris: "#c4a7e7", "highlight-low": "#21202e", "highlight-med": "#403d52", "highlight-high": "#524f67" },
  moon: { base: "#232136", surface: "#2a273f", overlay: "#393552", muted: "#6e6a86", subtle: "#908caa", text: "#e0def4", love: "#eb6f92", gold: "#f6c177", rose: "#ea9a97", pine: "#3e8fb0", foam: "#9ccfd8", iris: "#c4a7e7", "highlight-low": "#2a283e", "highlight-med": "#44415a", "highlight-high": "#56526e" },
  dawn: { base: "#faf4ed", surface: "#fffaf3", overlay: "#f2e9e1", muted: "#9893a5", subtle: "#797593", text: "#575279", love: "#b4637a", gold: "#ea9d34", rose: "#d7827e", pine: "#286983", foam: "#56949f", iris: "#907aa9", "highlight-low": "#f4ede8", "highlight-med": "#dfdad9", "highlight-high": "#cecacd" },
};

const NORD: [string, string][] = [
  ["nord0", "#2e3440"], ["nord1", "#3b4252"], ["nord2", "#434c5e"], ["nord3", "#4c566a"],
  ["nord4", "#d8dee9"], ["nord5", "#e5e9f0"], ["nord6", "#eceff4"],
  ["nord7", "#8fbcbb"], ["nord8", "#88c0d0"], ["nord9", "#81a1c1"], ["nord10", "#5e81ac"],
  ["nord11", "#bf616a"], ["nord12", "#d08770"], ["nord13", "#ebcb8b"], ["nord14", "#a3be8c"], ["nord15", "#b48ead"],
];

const SOLARIZED: [string, string][] = [
  ["base03", "#002b36"], ["base02", "#073642"], ["base01", "#586e75"], ["base00", "#657b83"], ["base0", "#839496"], ["base1", "#93a1a1"], ["base2", "#eee8d5"], ["base3", "#fdf6e3"],
  ["yellow", "#b58900"], ["orange", "#cb4b16"], ["red", "#dc322f"], ["magenta", "#d33682"], ["violet", "#6c71c4"], ["blue", "#268bd2"], ["cyan", "#2aa198"], ["green", "#859900"],
];

/** The rows of the four hand-kept sets, in their documented order. */
export function handKept(): Row[] {
  const rows: Row[] = [];
  for (const [v, table] of [["light", APPLE_LIGHT], ["dark", APPLE_DARK]] as const) for (const [n, h] of Object.entries(table)) rows.push({ id: `apple/${v}/${n}`, n: `${n} (${v})`, h, s: "apple", v });
  for (const [v, table] of Object.entries(ROSE_PINE)) for (const [n, h] of Object.entries(table)) rows.push({ id: `rp/${v}/${n}`, n: `${n} (${v})`, h, s: "rosepine", v });
  for (const [n, h] of NORD) rows.push({ id: `nord/${n}`, n, h, s: "nord" });
  for (const [n, h] of SOLARIZED) rows.push({ id: `sol/${n}`, n, h, s: "solarized" });
  return rows;
}

// ---- where a token is used -------------------------------------------------------

const CATPPUCCIN_ROLES: Record<string, string> = {
  rosewater: "cursor, winbar", flamingo: "cursor line, a second accent", pink: "markup, a second keyword colour", mauve: "keywords, the main accent", red: "errors, deletions", maroon: "a softer red for secondary errors",
  peach: "numbers, constants", yellow: "warnings, classes, annotations", green: "strings, additions, success", teal: "regex, parameters", sky: "operators", sapphire: "a second blue", blue: "functions, methods, links", lavender: "links, the cursor line number",
  text: "body copy", subtext1: "sub-headlines, labels", subtext0: "sub-headlines, labels", overlay2: "comments", overlay1: "comments, borders", overlay0: "borders, line numbers", surface2: "selections, a third surface", surface1: "code blocks, a second surface", surface0: "surface elements, the first surface", base: "the background", mantle: "secondary panes, sidebars", crust: "borders, status bars, the outer edge",
};
const ROSE_PINE_ROLES: Record<string, string> = {
  base: "the primary background", surface: "sidebars and panels", overlay: "floating panels, tooltips", muted: "comments, ignored and disabled text", subtle: "secondary text, punctuation", text: "primary text",
  love: "errors, deletions, diagnostics", gold: "warnings, strings, numbers", rose: "booleans, symbols, the matching text", pine: "keywords, conditionals, operators", foam: "functions, tags, method names", iris: "variables, links, the accent",
  "highlight-low": "the cursor line", "highlight-med": "selections", "highlight-high": "borders, the strongest highlight",
};
const NORD_ROLES: Record<string, string> = {
  nord0: "Polar Night: the background", nord1: "Polar Night: status bars, selections, elevated panels", nord2: "Polar Night: the current line, the active selection", nord3: "Polar Night: comments, indent guides, disabled text",
  nord4: "Snow Storm: variables, UI text", nord5: "Snow Storm: subtle UI text", nord6: "Snow Storm: the main text, elevated text",
  nord7: "Frost: classes, types, primitives", nord8: "Frost: the primary accent, functions, the UI", nord9: "Frost: keywords, operators, punctuation", nord10: "Frost: pragmas, numbers, a second UI accent",
  nord11: "Aurora: errors, deletions", nord12: "Aurora: annotations, decorators", nord13: "Aurora: warnings, escape characters, regex", nord14: "Aurora: strings, additions, success", nord15: "Aurora: numbers",
};
const SOLARIZED_ROLES: Record<string, string> = {
  base03: "the dark background", base02: "dark background highlights", base01: "comments, secondary content (light: emphasised text)", base00: "the body text of the light theme", base0: "the body text of the dark theme", base1: "emphasised dark text, light comments", base2: "light background highlights", base3: "the light background",
  yellow: "keywords, types", orange: "constants, a second warning", red: "errors, deletions", magenta: "special symbols, numbers", violet: "a second accent, links", blue: "functions, links", cyan: "strings, regex", green: "keywords, additions, success",
};
const APPLE_ROLES: Record<string, string> = {
  red: "destructive actions, errors, badges", orange: "warnings, a second accent", yellow: "ratings, highlights", green: "success, positive states, calls", mint: "an accent alternative", teal: "an accent alternative", cyan: "an accent alternative",
  blue: "the default tint: links, buttons, selection", indigo: "an accent alternative", purple: "an accent alternative", pink: "an accent alternative", brown: "an accent alternative",
  gray: "primary grey: placeholders, secondary controls", gray2: "second grey: disabled text, separators", gray3: "third grey: borders, inactive controls", gray4: "fourth grey: fills", gray5: "fifth grey: fills, tertiary backgrounds", gray6: "sixth grey: grouped backgrounds",
};
const M3_ROLES: Record<string, string> = {
  "primary-40": "primary (light scheme)", "primary-80": "primary (dark scheme), inverse-primary (light)", "primary-90": "primary-container (light)", "primary-30": "primary-container (dark)", "primary-10": "on-primary-container (light)", "primary-100": "on-primary (light)", "primary-20": "on-primary (dark)",
  "secondary-40": "secondary (light)", "secondary-80": "secondary (dark)", "secondary-90": "secondary-container (light)", "secondary-30": "secondary-container (dark)", "secondary-10": "on-secondary-container (light)",
  "tertiary-40": "tertiary (light)", "tertiary-80": "tertiary (dark)", "tertiary-90": "tertiary-container (light)", "tertiary-30": "tertiary-container (dark)", "tertiary-10": "on-tertiary-container (light)",
  "error-40": "error (light)", "error-80": "error (dark)", "error-90": "error-container (light)", "error-30": "error-container (dark)", "error-10": "on-error-container (light)",
  "neutral-99": "background and surface (light)", "neutral-10": "on-surface (light), surface (dark)", "neutral-90": "on-surface (dark)", "neutral-20": "inverse-surface (light)", "neutral-95": "inverse-on-surface (light)",
  "neutral-variant-90": "surface-variant (light)", "neutral-variant-30": "on-surface-variant (light), surface-variant (dark)", "neutral-variant-80": "on-surface-variant (dark), outline-variant (light)", "neutral-variant-50": "outline (light)", "neutral-variant-60": "outline (dark)",
};

/** Where the token is used, one line: the class or property it is spelled in and the role its palette gives it. */
export function usage(r: Row): string {
  const t = r.id.slice(r.id.lastIndexOf("/") + 1);
  switch (r.s) {
    case "css": return `Any CSS colour value: \`color: ${t}\`; one of the 148 named colours every browser knows.`;
    case "pal": return `pal's own token in the ${r.v} theme: \`var(--pal-${t})\` in the app's stylesheets.`;
    case "tailwind": {
      const [hue, step] = t.split("-");
      return step ? `\`bg-${t}\`, \`text-${t}\`, \`border-${t}\` and every other colour utility; \`--color-${t}\` in v4. ${step === "500" ? "The hue's base shade." : Number(step) < 500 ? `A light ${hue}: backgrounds and tints.` : `A dark ${hue}: text and emphasis.`}` : `\`bg-${t}\`, \`text-${t}\`: Tailwind's ${t}.`;
    }
    case "material": {
      const [, shade] = t.split(/-(?=[a0-9]+$)/);
      return `Material 2014 palette: ${shade === "500" ? "the hue's primary shade" : shade?.startsWith("a") ? "an accent shade, for emphasis on a primary of the same hue" : Number(shade) < 500 ? "a light shade, for backgrounds and tints" : "a dark shade, for status bars and emphasis"} (\`${t}\`).`;
    }
    case "material3": {
      const role = M3_ROLES[t];
      return `Material 3 tonal palette, tone ${t.slice(t.lastIndexOf("-") + 1)}${role ? `: \`md.sys.color.${role.replace(/ \(.*\)/, "")}\`, the ${role}` : ""}. Tones pair for contrast: 40 on 100, 80 on 20, 10 on 90.`;
    }
    case "apple": return `\`UIColor.${token(r)}\` / \`NSColor.${token(r)}\` in the ${r.v} appearance: ${APPLE_ROLES[t] ?? "a system colour"}.`;
    case "catppuccin": return `Catppuccin ${cap(r.v ?? "")}'s ${t}: ${CATPPUCCIN_ROLES[t] ?? "an accent"}.`;
    case "rosepine": return `Rosé Pine ${cap(r.v ?? "")}'s ${t}: ${ROSE_PINE_ROLES[t] ?? "an accent"}.`;
    case "nord": return `${NORD_ROLES[t] ?? "Nord"}.`;
    case "solarized": return `Solarized ${t}: ${SOLARIZED_ROLES[t] ?? "an accent"}.`;
  }
}
