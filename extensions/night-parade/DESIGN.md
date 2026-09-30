# Night Parade: design

The *Hyakki Yagyō*, the Night Parade of One Hundred Demons, marches through an
abandoned village tonight. You are caught outside. Last until dawn.

This is the source of truth for the game's rules and content. Numbers live in
`game/content/*.ts`; this file says what each thing is for and how the parts
fit, so a change to one can be judged against the rest.

## Pillars

1. **A build you chose.** Every level-up is a real decision: 16 weapons and 16
   items that each do one clear thing, 16 evolutions that reward planning, and
   tools to steer (reroll, skip, banish). Two runs with different heroes, or
   the same hero with different picks, should feel different.
2. **A night with a shape.** Not a rising tide of the same thing: three acts,
   each with its own crowd, scripted events and a boss; mini-bosses between
   them; moments to look forward to (the lantern procession, the blood moon).
3. **Every hit lands.** Flash, knockback, numbers, sparks, a bit of shake on
   the big ones, sound. Power grows visibly: a level 1 screen is sparse, a
   minute-12 screen is a storm you made.
4. **Readable at 720 by 390.** pal's panel is small. Sprites stay crisp at
   whole-number zoom, danger is telegraphed (a red ring before a slam), the HUD
   stays at the edges, and every card works with a few keys.
5. **Worth coming back to.** Gold buys lasting upgrades at the shrine; heroes,
   weapons and harder nights unlock by playing; the codex fills in.

## The night

A run is **15 minutes** in three acts, then the final boss. Time only moves
while you play; hiding pal's panel pauses it.

| Act | Time | Mood | Boss |
| --- | --- | --- | --- |
| I. Dusk | 0:00 to 5:00 | The village road; small spirits and animals | 2:30 the Giant Frog (mini), 5:00 the Tanuki |
| II. Midnight | 5:00 to 10:00 | Spirits and the dead rise; ranged enemies appear | 7:30 the Yūrei (mini), 10:00 the Tengu |
| III. Hour of the Ox | 10:00 to 15:00 | *Ushi-mitsu*, the witching hour; oni and fire | 12:30 the Red Samurai (mini), 15:00 the Oni |

Beat the Oni and dawn breaks: the run is won. The screen starts in deep
blue-black with a pool of lantern light around you, lifts through the acts,
and turns gold only when the Oni falls.

### The crowd

Each minute brings its own mix (a table in `stage.ts`), so the crowd changes
character. The rules underneath:

- A **minimum alive** that rises through the night, topped up at once, and a
  **trickle** of batches on top.
- Enemy **health scales** with the minute and with how strong you are (level),
  so a strong build still meets resistance, but more slowly than it grows.
- Enemies left far behind **come round again** ahead of you.
- A hard cap of 400 enemies keeps it smooth.

### Events

Scripted beats announced with a banner. Each teaches or tests something:

| Time | Event | What it does |
| --- | --- | --- |
| 1:00 | Bats in the rafters | A stream of bats crosses the screen in a line. Dodge or cut through. |
| 2:30 | **Giant Frog** | Mini-boss: hops at you, lands with a shockwave ring (telegraphed). Drops a chest. |
| 3:30 | The lantern procession | A column of chōchin-obake marches across. Destroy every lantern before it leaves and a gold chest drops at the last one. |
| 4:15 | Mushroom ring | A ring of mushrooms closes in around you. Break out before it tightens. |
| 5:00 | **The Tanuki** | Boss. Rolls at you, leaves leaf decoys of itself, turns to stone (invulnerable, telegraphed) and slams. |
| 6:00 | The restless dead | Skeletons climb out of the ground around you (dust telegraph). |
| 7:30 | **Yūrei** | Mini-boss: blinks around you, fires slow rings of wisps. |
| 8:30 | Spirit storm | Spirits teleport in close for 30 s. Keep moving. |
| 9:15 | Skull stampede | A wave of skulls charges from one side. |
| 10:00 | **The Tengu** | Boss. Teleports (shimmer telegraph), fans rings of feathers, gusts you back. Below half: summons crows and speeds up. |
| 11:00 | Blood moon | For 40 s everything is faster and red, and drops double experience. |
| 12:30 | **Red Samurai** | Mini-boss: telegraphed dash-slashes along a line. |
| 13:30 | The oni procession | Oni imps and fire in a marching column. |
| 14:30 | The drums | The ground shakes; the crowd thickens for the finale. |
| 15:00 | **The Oni** | Final boss, twice the size of anything else: telegraphed ground slams, a thrown club, summoned imps; enrages at half. |

Now and then (once or twice a run, not in the first minute) a **golden
tanuki** appears and runs from you. Catch it within 15 seconds for a pile of
gold and a chest.

## Moving and fighting

- **Move**: arrows or WASD, 8 directions.
- **Smoke dash**: Space. A short dash (0.16 s) you can't be hurt in, 2.2 s to
  come back (heroes and items change both). The one active skill: it gets you
  out of a ring, across a stream of bats, past a slam.
- **Weapons fire on their own.** Some aim at the nearest enemy, some at the
  toughest, some go the way you face, some circle you or lie on the ground.
- **You are hurt** by touching enemies and by enemy shots. After a hit you
  can't be hurt again for 0.5 s. **Armor** takes a flat amount off every hit
  (never below 1).
- **Knockback** pushes most enemies; bosses and elites resist it.
- **Status effects** from weapons: *slow* (ice), *freeze* (ice, blizzard),
  *stun* (geyser, bell, earthquake), *root* (vines), *burn* (fire). Bosses
  shrug freeze and root off quickly.
- **Crits**: some weapons can crit (double damage, yellow numbers). Luck adds
  to every weapon's crit chance.

## Stats

Everything you pick changes a small set of stats. Weapons read them.

| Stat | Does | Start |
| --- | --- | --- |
| Max health | | 100 |
| Recovery | health a second | 0 |
| Armor | taken off each hit | 0 |
| Might | weapon damage | 100% |
| Area | size of blasts, cuts, auras | 100% |
| Speed | how fast projectiles fly | 100% |
| Duration | how long effects last | 100% |
| Amount | extra projectiles | +0 |
| Cooldown | time between attacks | 100% |
| Move speed | | 66 px/s |
| Magnet | pickup reach | 36 px |
| Luck | crits, chest size, a fourth choice | 0% |
| Growth | experience | 100% |
| Greed | gold | 100% |
| Curse | enemy count, speed and health, and experience | 0% |
| Revival | extra lives | 0 |

Stats come from the hero, the shrine, and items, added together.

## Heroes

Six, two open from the start. Each starts with a weapon and has a trait that
nudges the build.

| Hero | Sprite | Starts with | Trait | Unlock |
| --- | --- | --- | --- | --- |
| **Kaze**, ninja | NinjaBlue | Shuriken | *Shadowstep*: dash comes back 40% faster and leaves a smoke puff that hurts | open |
| **Tomoe**, samurai | Samurai | Katana | *Iron will*: +2 armor, +30 max health, to stand in the crowd her katana needs | open |
| **Seimei**, onmyōji | SorcererBlack | Fire talisman | *Five elements*: +15% area and duration, 10 less max health | Evolve any weapon |
| **Ennen**, monk | Monk | Temple bell | *Serenity*: +0.4 recovery; each 100 enemies defeated heals 10 | Reach Midnight (5:00) |
| **Raiden**, thunder ninja | NinjaThunder | Thunder | *Storm-born*: +10% crit chance; crits push enemies back | Defeat the Tengu |
| **Hayate**, tengu | Tengu | Tengu fan | *Wind-walker*: +15% move speed, +50% magnet | See the dawn |

## Weapons

Sixteen. Each has one job; most have 8 levels, each level a specific change
the card shows ("+1 shuriken", "Damage +4"). You carry up to **6 weapons** and
**6 items**.

Roles, so a build can cover its weaknesses: *aimed* (hits what's near),
*facing* (you point it), *around* (protects you), *field* (hits where you've
been), *random* (anywhere on screen), *control* (slows, stops or pushes).

| # | Weapon | Icon | Role | What it does |
| --- | --- | --- | --- | --- |
| 1 | Shuriken | Shuriken | aimed | Thrown at the nearest enemies, passing through a few. |
| 2 | Kunai | Kunai | facing | A fast volley the way you face. Great DPS if you aim with your feet. |
| 3 | Katana | Cut | around | A wide cut in front, then behind. Hits everything in the arc. |
| 4 | Naginata | MagicWeapon | facing | A long thrust that pierces a whole line and knocks it back hard. |
| 5 | Kusarigama | Hook | around | A sickle on a chain sweeps a circle around you, always. |
| 6 | Yumi | Arrow | aimed | A heavy arrow at the toughest enemy in range. Crits often. |
| 7 | Fire talisman | Fireball | random | A fireball that bursts where it lands. |
| 8 | Thunder | BookThunder | random | Strikes enemies around you from above. |
| 9 | Spirit wisps | OrbLight | around | Spirits orbit you for a few seconds, then rest. |
| 10 | Temple bell | Sing | around, control | A chant around you: steady damage, a gentle push. |
| 11 | Rock spikes | RockSpike | around | Spikes burst up in a ring around you. |
| 12 | Ice talisman | BookIce | aimed, control | A fan of ice shards that slows; sometimes freezes. |
| 13 | Water geyser | WaterCanon | random, control | Geysers burst under crowds and stun them. |
| 14 | Caltrops | Explosion | field | Dropped behind you as you run; bombs join in later. |
| 15 | Tengu fan | BookWind | facing, control | A gust that pierces and pushes everything back. |
| 16 | Vines | BookPlant | field, control | Vines burst along a line, rooting what they catch. |

### Evolutions

A weapon at level 8, while you carry its item (any level), evolves at the next
chest. The level-up card says which item a weapon wants, and marks an item that
completes a pair you're holding.

| Weapon | + Item | Evolution | Becomes |
| --- | --- | --- | --- |
| Shuriken | Scroll | **Storm of Stars** | Homing stars that pass through everything and come back to you. |
| Kunai | Waraji | **Thousand Blades** | A constant stream of blades, doubled while you move. |
| Katana | Moon charm | **Crescent Moon** | A full circle of two blades every swing; can crit. |
| Naginata | Whetstone | **Dragon's Spine** | Thrusts in four directions with a shockwave that runs the length of the screen. |
| Kusarigama | Oni mask | **Shinigami's Wheel** | Three scythes swing in and out; enemies under 10% health are cut down outright. |
| Yumi | Tailwind | **Hachiman's Bow** | Every arrow crits and splits into three on its first hit. |
| Fire talisman | Incense | **Kitsune-bi** | Bursts leave foxfire burning on the ground. |
| Thunder | Omamori | **Raijin's Drums** | Each strike chains to three more; strikes crit. |
| Spirit wisps | Healing herbs | **Hitodama** | Two rings that never rest; hits now and then heal you. |
| Temple bell | Dō armor | **Great Bell** | Every few seconds a gong wave rolls out, stunning; damage grows with your max health. |
| Rock spikes | Kabuto | **Earthquake** | Three rings ripple out; the ground shakes and stuns. |
| Ice talisman | Green tea | **Blizzard** | Every 8 s the whole screen freezes for 2 s. |
| Water geyser | Lodestone ring | **Whirlpool** | Geysers become whirlpools that drag enemies in. |
| Caltrops | Maneki-neko | **Festival Crackers** | Strings of firecrackers; what they kill drops extra gold. |
| Tengu fan | Yata mirror | **Tengu Tempest** | A tornado wanders around you and shreds enemy shots. |
| Vines | Rising sun | **Sacred Grove** | Bamboo erupts in rings spreading outward, rooting everything. |

## Items

Sixteen. Most go to 5 levels.

| Item | Icon | Each level | Evolves |
| --- | --- | --- | --- |
| Kabuto | Helmet | Armor +1 | Rock spikes |
| Dō armor | Armor | Max health +20 | Temple bell |
| Healing herbs | Heal | Recovery +0.2/s | Spirit wisps |
| Whetstone | AttackUpgrade | Might +10% | Naginata |
| Incense | Mist | Area +10% | Fire talisman |
| Moon charm | Moon | Duration +12% | Katana |
| Green tea | Potion | Cooldown -8% | Ice talisman |
| Scroll | Scroll | Amount +1 (2 levels) | Shuriken |
| Tailwind | Upgrade | Speed +12% | Yumi |
| Waraji | Boot | Move speed +8% | Kunai |
| Lodestone ring | Ring | Magnet +30% | Water geyser |
| Omamori | Amulet | Luck +10% | Thunder |
| Rising sun | Sun | Growth +8% | Vines |
| Maneki-neko | Money | Greed +15% | Caltrops |
| Yata mirror | Counter | Revival +1 (1 level) | Tengu fan |
| Oni mask | Death | Curse +10%: more, faster, tougher enemies and more experience | Kusarigama |

## Level-ups

- **Three choices**, sometimes four (Luck). What you already carry comes up a
  little more often than something new; nothing offered is a dead end (a full
  slot bar offers only what you have).
- **Reroll** (R), **Skip** (X, for a little gold) and **Banish** (B, then
  pick: that thing never comes up again this run) have charges from the shrine
  and some heroes.
- Each card shows the icon, name, *New* or the level, the exact change, and
  for a weapon its item ("evolves with Scroll", starred when you hold it).
- With everything maxed, the choices become gold or a meal.
- **Blessings**: when Midnight (5:00) and the Hour of the Ox (10:00) begin,
  a card of three blessings, one to keep for the rest of the night: +25%
  damage, one more of every projectile, +25% area, −12% cooldown, +3 armor
  and +40 health, +1.5 health a second (and a full heal), or +15% move speed
  and pickup reach. No reroll, skip or banish; it uses no level, and a
  level-up waiting comes after it. It is the power spike before each act's
  bosses.

## Enemies

Twenty-four kinds in six behaviours. All are 16 px sprites from the pack.

| Behaviour | What it does | Who |
| --- | --- | --- |
| Chase | Walks at you | slime, larva, mushroom, kappa, bamboo, cyclops, panda, oni imp |
| Weave | Zigzags at you | bat, lantern, spirit, onibi |
| Lunge | Pauses (a shiver), then charges | snake, spider, owl, beast, oni imp |
| Shoot | Keeps its distance and fires | kappa (water), eye (bolt), octopus (ink, slows), dragon (fire) |
| Burrow | Moves underground (a dust trail), surfaces beside you | mole |
| Blink | Fades and reappears near you | spirit, yūrei |

Plus: **slimes split** into two small ones; **onibi burst** when they die
(a red ring first); **skeletons** rise from the ground.

### Elites

At :30 each minute and in events: a bigger, tinted enemy with an aura and a
**trait** (two in Act III): *Swift* (faster), *Hulking* (bigger, much tougher),
*Shielded* (a shield soaks the first hits), *Splitting* (bursts into three),
*Burning* (leaves fire behind). Elites resist knockback and drop a chest.

### Bosses

Every boss **telegraphs** its big moves (a red ring or line on the ground, a
wind-up pose), has a health bar with its name, resists crowd control, and drops
a gold chest. Below half health each boss changes (faster, a new move).

## Pickups

- **Experience gems**: green (1), blue (3+), red (10+); when too many lie
  around, new experience joins the one nearest you.
- **Gold**: coins (1), pouches (10), money bags (25). Greed multiplies.
- **Food**: onigiri (+30 health), a feast (full health).
- **Specials**, rare: the *shakuhachi* (every gem on the map flies to you), the
  *hourglass* (enemies stop for 6 s), the *ofuda* (purifies every enemy on
  screen), the *sake gourd* (can't be hurt for 8 s).
- **Chests**: from elites, mini-bosses and bosses. A chest opens with a short
  reveal: one prize, three, or five (Luck and the source decide). An evolution
  comes first if one is ready.

### Breakables

Jars and stone lanterns stand along the village; any weapon breaks them. They
drop gold, food and now and then a special. They also light the dark a little.

## The world

An endless abandoned village at night, generated in chunks from a seed:
grass and dirt paths, trees (pines, maples, cherry blossoms), bushes, rocks,
ruined houses, graves, fences, jars and lanterns. Scenery doesn't block you
(the fight is the point); tall things fade when you walk behind them.

Ambient: fireflies, drifting leaves and petals, a slow ground fog, the moon.

## Presentation

- **HUD**: experience bar with level; the clock; kills and gold; weapon and
  item slots with level pips; your health under you; a boss bar with its name.
- **Juice**: hit flash and numbers (crits bigger and yellow), sparks, death
  pops, gem sparkle and a whoosh when gems fly in, a light column on level-up,
  a little screen shake for big hits, a red edge when you're hurt and a pulse
  when you're low, dash afterimages, a name card when a boss arrives.
- **Title**: the village at night with the parade marching past; Begin,
  Shrine, Codex, Settings.
- **Hero select**: portraits, trait, starting weapon, lock conditions.
- **Pause**: your build and your stats.
- **Results**: time, level, kills, gold; for every weapon its damage, share and
  kills; what you unlocked.
- **Sound**: a track per act, one for bosses, one for the Oni, a dawn theme;
  every weapon has its sound, and busy sounds are throttled.
- **Settings**: music and sound volume, damage numbers, screen shake.

## Between nights

- **Gold**: what a night picks up, plus a bonus when it ends: 15 a minute
  survived, 40 a boss beaten, 250 for the dawn, all times Greed. The results
  screen shows both, and the title marks the Shrine while a rank is
  affordable.
- **The shrine**: spend gold on lasting stat upgrades (might, armor, health,
  recovery, cooldown, area, speed, duration, amount, move speed, magnet, luck,
  growth, greed, revival, rerolls, skips, banishes), each a few ranks, each rank
  dearer. A refund puts everything back.
- **Unlocks**: heroes (above), and weapons beyond the first ten: Yumi, Water
  geyser, Tengu fan, Vines, Ice talisman and Kusarigama each open on a
  condition shown in the codex.
- **Omens**: after the first dawn, harder nights (up to five): each makes the
  parade tougher and faster and pays more gold.
- **Codex**: every weapon and evolution seen, every enemy with its count, the
  achievements.

## Tuning targets

Checked with the bot (`scripts/survey.ts`, `scripts/bosstime.ts`) and by hand.
When the night is too hard, the answer is more for the player (power,
abilities, faster progression, threats that read better), never a thinner or
weaker parade.


- A new player with Kaze reaches Midnight (5:00) on a first or second try and
  sees dawn within a few nights with a few shrine ranks.
- About level 20 by 5:00, 35 by 10:00, 50 by 15:00.
- A first evolution around 7:00 to 9:00 in a focused build.
- Every weapon, alone at level 8, within about 30% of the others' damage in the
  per-weapon benchmark (`scripts/dps.ts`), control weapons lower by design.
- 400 enemies and their effects hold 60 fps at pal's panel size.
