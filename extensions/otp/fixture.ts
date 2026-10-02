// Writes app/src/gallery/shots/otp.json and bar-otp.json: the store
// screenshots' fixtures, one day of made-up codes (the senders and texts are
// this file's) through the extension's own row (index.ts `item`, the code
// pulled out by `extract`) and popover (view.ts `render`), at the kit's clock.
// `bun run extensions/otp/fixture.ts`, then `make shots EXT=otp`.
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";

// The sdk reads PAL_NOW once at load: pin it before the extension comes in.
pinClock();
const { extract, item } = await import("./index.ts");
const { render } = await import("./view.ts");
type Code = import("./index.ts").Code;

const MIN = 60_000;
let n = 0;
const code = (name: string, text: string, ago: number, sender = name): Code => ({ id: String(++n), code: extract(text)!, name, sender, text, at: NOW - ago });

// Newest first: a bank's login code 13 s ago, a sign-in code, a parcel PIN, a 2FA code from the morning, two from yesterday.
const codes = [
  code("NORTHBANK", "NORTHBANK: your mobile banking login code is 482913. Never share it, not even with us.", 13_000),
  code("Google", "G-731064 is your Google verification code.", 6 * MIN, "22000"),
  code("Acme Delivery", "Acme Delivery: your pickup PIN is 2841. Show it at the counter.", 41 * MIN, "info@acme.example"),
  code("Forgebase", "Your Forgebase authentication code is 559104", 4 * 60 * MIN - 17 * MIN),
  code("SKYWAYS", "Use code 90237 to confirm your seat change for flight SW214.", 25 * 60 * MIN + 12 * MIN),
  code("Ada Kaya", "Kapı şifresi 7316, 3. kattayız", 28 * 60 * MIN + 48 * MIN, "+90 532 555 01 47"),
];
const [latest, ...previous] = codes;

const today = new Date(NOW);
writeFixture("otp", {
  palettes: { otp: { title: "Verification Codes", icon: { tile: { glyph: "\u{f0369}", bg: "green" } }, live: true, placeholder: "Search codes and senders", items: codes.map((c) => item(c, today)) } },
  shots: {
    "1-codes": { palette: "otp", keys: [], caption: "Today's codes and yesterday's: the sender, the message, the code as a green tag, how long ago it came" },
    "2-detail": { palette: "otp", keys: ["down", "cmd+i"], caption: "The detail pane: the code large, who sent it with the number and when, the whole message" },
    "3-actions": { palette: "otp", keys: ["cmd+k"], caption: "Paste the code into the app in front, copy it (concealed, gone in 30 s), or copy the sender" },
  },
});

const fresh = { latest, previous: previous.slice(0, 2), now: NOW, window: 60_000 };
// The same moment had the bank's code come forty seconds ago: the bar nearly run down.
const late = { ...fresh, latest: { ...latest, at: NOW - 40_000 } };
const bar = {
  key: "otp/latest-code",
  title: "Latest code",
  item: { icon: "\u{f084}", title: latest.code, color: "green", tooltip: `${latest.name}: ${latest.text}`, refresh: 47, menu: { view: render(fresh) } },
  states: [
    { id: "late", item: { refresh: 20, menu: { view: render(late) } } },
    // Past the minute: the strip hides, the popover (reached by its hotkey) says so.
    { id: "none", item: { hidden: true, menu: { view: render({ previous: codes.slice(0, 3), now: NOW + 120_000, window: 60_000 }) } } },
  ],
  shots: {
    "menubar": { target: "menubar", caption: "On the menu bar: the code that just arrived, in green, for a minute" },
    "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the code large, who sent it, the minute counting down, the two codes before it; Enter copies" },
    "popover-late": { target: "menubar", popover: true, state: "late", caption: "A code forty seconds in: the bar nearly run down, the item gone twenty seconds later" },
    "sketchybar": { target: "sketchybar", caption: "On sketchybar: the key glyph and the code, both green" },
  },
};
writeFixture("bar-otp", bar);
console.log(`otp.json: ${codes.length} codes; bar-otp.json: ${Object.keys(bar.shots).length} shots`);
