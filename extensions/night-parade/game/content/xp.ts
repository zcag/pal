// Experience from level n to n+1. Gentle early so the first minutes are a
// run of choices, steeper after 20 and 40 (Vampire Survivors' shape). Tuned
// against docs/design.md's targets: about 20 by 5:00, 35 by 10:00, 50 by 15:00.
export const needed = (n: number) => (n < 20 ? 5 + 10 * (n - 1) : n < 40 ? 195 + 30 * (n - 20) : 795 + 45 * (n - 40));
