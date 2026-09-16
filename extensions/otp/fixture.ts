// Writes app/src/gallery/shots/bar-otp.json: the bar item's fixture for
// the store screenshots, its popover tree from view.ts over made-up codes
// (the senders and texts are this file's). `bun run
// extensions/otp/fixture.ts`, then `node app/scripts/shots.mjs bar otp`.
import { writeFileSync } from "node:fs";
import { render, type OtpState, type ShownCode } from "./view.ts";

const NOW = 1_758_050_000_000;
const code = (id: string, code: string, name: string, text: string, agoMs: number, sender = name): ShownCode => ({ id, code, name, sender, text, at: NOW - agoMs });

const latest = code("1", "482913", "Akbank", "Akbank Mobil giris kodunuz: 482913. Kodu kimseyle paylasmayin.", 13_000, "AKBANK");
const previous = [
  code("2", "731064", "Google", "G-731064 is your Google verification code.", 6 * 60_000, "22000"),
  code("3", "8765", "Shop", "Your one-time passcode is 8765. It expires in 10 minutes", 41 * 60_000, "info@shop.example"),
];
const fresh: OtpState = { latest, previous, now: NOW, window: 60_000 };
const gcode: OtpState = { latest: { ...previous[0], id: "4", at: NOW - 40_000 }, previous: [latest, previous[1]], now: NOW, window: 60_000 };

const bar = {
  key: "otp/latest-code",
  title: "Latest code",
  item: {
    icon: "\u{f084}",
    title: "482913",
    color: "green",
    tooltip: "Akbank: Akbank Mobil giris kodunuz: 482913. Kodu kimseyle paylasmayin.",
    refresh: 47,
    menu: { view: render(fresh) },
  },
  states: [
    { id: "gcode", item: { title: "731064", tooltip: "Google: G-731064 is your Google verification code.", menu: { view: render(gcode) } } },
  ],
  shots: {
    "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: the code that just arrived, in green, for a minute" },
    "bar-menubar-light": { target: "menubar", theme: "light", caption: "The same item on a light menu bar" },
    "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "A click opens the popover: the code large, who sent it, the minute counting down, the two codes before it; Enter copies" },
    "bar-menubar-popover-dark": { target: "menubar", theme: "dark", popover: true, caption: "The same popover in the dark theme" },
    "bar-menubar-popover-gcode": { target: "menubar", theme: "light", popover: true, state: "gcode", caption: "A Google code forty seconds in: the bar nearly run down" },
    "bar-sketchybar": { target: "sketchybar", theme: "dark", caption: "On sketchybar: the key glyph and the code, both green" },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/bar-otp.json", import.meta.url), JSON.stringify(bar) + "\n");
console.log(`bar-otp.json: ${Object.keys(bar.shots).length} shots`);
