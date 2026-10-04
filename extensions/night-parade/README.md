# Night Parade

A survivors game. In Japanese folklore the *Hyakki Yagyō*, the Night Parade
of One Hundred Demons, marches through town, and anyone caught outside
doesn't see morning. You're caught outside, in an abandoned village. Enter
on the palette's row (or its hotkey) opens it as a view level whose body is
the extension's own page (`surface/`, a `surface` view node).

Weapons fire on their own; you move, dash through the crowd, and at every
level choose what to grow. A night is fifteen minutes. Beat the Oni at its
end and dawn breaks.

The whole design, and why each part is there: [DESIGN.md](DESIGN.md).

## Playing

- **The night**: three acts, each with its own crowd and scripted events.
  - *Dusk*, 0:00 to 5:00: slimes, bats and snakes, the lantern procession
    (break every lantern before it passes for a chest), a ring of
    mushrooms, the Giant Frog at 2:30, the Tanuki at 5:00.
  - *Midnight*, 5:00 to 10:00: the dead rise, spirits blink beside you, eyes
    and octopus fire from a distance; the Yūrei at 7:30, the Tengu at 10:00.
  - *The Hour of the Ox*, 10:00 to 15:00: oni and fire, a blood moon, the oni
    procession and the drums; the Red Samurai at 12:30, the Oni at 15:00.

  Every big move is marked on the ground first, a red ring or line, and each
  boss changes below half health. Now and then a golden tanuki runs from you
  with a fortune.
- **Your build**: sixteen weapons, each with a job (aimed, facing, around
  you, on the ground, anywhere, control) and eight levels whose exact change
  the card shows; sixteen items, each raising one stat. A weapon at level 8
  evolves at the next chest if you carry its item; the level-up card stars
  an item that completes a pair you hold. Six weapons and six items at most.
- **Heroes**: Kaze (shuriken, a quicker dash), Tomoe (katana, armor),
  Seimei (fire talisman, area), Ennen (temple bell, healing), Raiden
  (thunder, crits), Hayate (Tengu fan, speed). Kaze and Tomoe start open;
  the others unlock by playing.
- **Enemy shots** carry a red rim, and your attacks break the ones they
  touch: a slash, a thrust, an explosion, a spirit or a shuriken in flight.
- **Pickups**: experience gems (they drift to you if left behind), gold,
  food, and rarer finds in the jars and stone lanterns along the road: the
  shakuhachi (every gem comes to you), the hourglass (the parade stops),
  the ofuda (the screen is purified), the sake gourd (nothing can hurt you).
- **Blessings**: as Midnight and the Hour of the Ox begin, three blessings
  to choose one from for the rest of the night (more damage, more
  projectiles, more area, faster cooldowns, armor, healing, or speed).
- **Between nights**: a night pays what you picked up plus a bonus for how
  long you lasted, the bosses you beat and the dawn; gold buys lasting upgrades at the shrine (might,
  armor, health, recovery, cooldown, area and more, rerolls, skips and
  banishes), the codex keeps every weapon, item and enemy you've met, and
  after your first dawn the omens make the parade harder and pay more.

## Keyboard

| Key | Does |
| --- | --- |
| Arrows or WASD | Move |
| Space | Smoke dash |
| `1` `2` `3` (or `↑` `↓` and Enter) | Pick at a level-up |
| `R` `X` `B` | Reroll, skip, banish (at a level-up) |
| Enter, `P` | Pause or carry on; the pause card shows your build and stats |
| `S` (paused) | The game's settings (music, sound, damage numbers, shake) over the paused night; Backspace goes back to it |
| `Q` (paused) | Give up the night |
| `M` | Sound on or off |
| Backspace | Back, on the title's screens |
| `` ` `` | Frames a second and what's on the field |
| Escape | Leave (the night pauses and is kept: closing pal and coming back finds it paused) |

⌘K lists Pause, Sound on or off, and Give up the night.

## Setup

None. The save (gold, shrine ranks, unlocks, the codex, records) is the
extension's storage, synced when signed in to a pal account; music and sound volume, damage numbers and screen
shake are the page's own Settings.

## Working on it

- `game/content/` holds every number and word, `game/sim/` the night (no
  DOM, 60 steps a second from a seed), `game/meta.ts` the save, and
  `game/bot.ts` a player that needs no keyboard. The page is `surface/`.
- `bun host/src/surface.ts extensions/night-parade` serves the page in a
  browser; `?dev` puts its state on `window.np`.
- `bun extensions/night-parade/scripts/survey.ts kaze 24 [shrine]`: the bot
  plays many nights and prints how far they got, levels, bosses, what hurt;
  `scripts/dps.ts` benchmarks every weapon alone; `scripts/bosstime.ts`
  times each boss.
- The pictures are the
  [Ninja Adventure](https://pixel-boy.itch.io/ninja-adventure-asset-pack)
  pack by Pixel-Boy and AAA (CC0, `surface/assets/LICENSE-ninja-adventure.txt`);
  `assets.txt` lists every file and where it came from, and
  `scripts/assets.sh <pack dir>` rebuilds `surface/assets/` from the pack.

## Platforms

macOS and Linux.
