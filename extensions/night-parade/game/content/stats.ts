// The player's stats: what heroes, shrine ranks and items add up to, and
// what every weapon reads. All additive; multipliers are stored as their
// excess over 1 (might 0.1 is +10%), so sources simply sum.

export type StatKey =
  | "maxHp" | "recovery" | "armor" | "might" | "area" | "speed" | "duration" | "amount" | "cooldown"
  | "move" | "magnet" | "luck" | "growth" | "greed" | "curse" | "revival" | "dash";

export type Stats = Record<StatKey, number>;

/** A bare player, before hero, shrine and items. */
export const BASE: Stats = {
  maxHp: 100, recovery: 0, armor: 0, might: 0, area: 0, speed: 0, duration: 0, amount: 0, cooldown: 0,
  move: 66, magnet: 42, luck: 0, growth: 0, greed: 0, curse: 0, revival: 0, dash: 0,
};

export const add = (a: Stats, b: Partial<Stats>): Stats => {
  const out = { ...a };
  for (const k in b) out[k as StatKey] += b[k as StatKey] ?? 0;
  return out;
};

/** How each stat reads on a card or in the pause screen. */
export const STAT_NAMES: Record<StatKey, string> = {
  maxHp: "Max health", recovery: "Recovery", armor: "Armor", might: "Might", area: "Area", speed: "Speed", duration: "Duration",
  amount: "Amount", cooldown: "Cooldown", move: "Move speed", magnet: "Magnet", luck: "Luck", growth: "Growth", greed: "Greed",
  curse: "Curse", revival: "Revival", dash: "Dash",
};

export function statText(k: StatKey, v: number): string {
  const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%`;
  switch (k) {
    case "maxHp": return `${v >= 0 ? "+" : "−"}${Math.abs(v)}`;
    case "recovery": return `+${v.toFixed(1)}/s`;
    case "armor": case "amount": case "revival": return `+${v}`;
    case "cooldown": return pct(-v);
    case "move": return pct(v / BASE.move);
    case "magnet": return pct(v / BASE.magnet);
    case "dash": return pct(-v);
    default: return pct(v);
  }
}
