// @vitest-environment happy-dom
// A glance card as drawn: an image icon is a cover beside the text (no
// icon in the label), `progress` runs along the foot, and the item's own
// lines (`glance.lines`) open what they name: a click on one is the card's
// key with the line's index, never the card's own click.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlanceStrip, type GlanceCard } from "../Glance";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, el: HTMLDivElement;
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const playing: GlanceCard = {
  key: "media/playing", label: "Now Playing", title: "Mr. Blue Sky", tooltip: "Pomplamoose · YouTube on Living Room",
  icon: { kind: "image", src: "data:image/png;base64,AAAA" }, progress: 0.42,
  lines: [{ text: "also: Weird Fishes · Spotify", action: "open:ctl:spotify" }, { text: "+1 more", action: "open:all" }],
};

describe("a glance card's cover, progress and lines", () => {
  it("draws the cover beside the text, the progress along the foot, and each line under it", () => {
    act(() => root.render(<GlanceStrip cards={[playing, { key: "gmail/unread", label: "Gmail", count: 3 }]} onOpen={() => {}} />));
    const [card, gmail] = [...el.querySelectorAll<HTMLElement>(".pal-glance__card")];
    expect(card.querySelector<HTMLImageElement>(".pal-glance__cover")!.src).toContain("data:image/png");
    expect(card.querySelector(".pal-glance__label .pal-icon"), "the cover is not also the label's icon").toBeNull();
    expect(card.querySelector(".pal-glance__value")!.textContent).toBe("Mr. Blue Sky");
    expect(card.querySelector(".pal-glance__sub")!.textContent).toBe("Pomplamoose · YouTube on Living Room");
    expect([...card.querySelectorAll(".pal-glance__line")].map((l) => l.textContent)).toEqual(["also: Weird Fishes · Spotify", "+1 more"]);
    expect(card.querySelector<HTMLElement>(".pal-glance__progress > span")!.style.width).toBe("42%");
    expect(gmail.querySelector(".pal-glance__cover, .pal-glance__line, .pal-glance__progress"), "a plain card has none of it").toBeNull();
  });

  it("opens the card on its click and a line on the line's, never both", () => {
    const onOpen = vi.fn();
    act(() => root.render(<GlanceStrip cards={[playing]} onOpen={onOpen} />));
    const card = el.querySelector<HTMLElement>(".pal-glance__card")!;
    act(() => card.querySelectorAll<HTMLElement>(".pal-glance__line")[1].click());
    expect(onOpen.mock.calls).toEqual([["media/playing", 1]]);
    act(() => card.click());
    expect(onOpen.mock.calls[1]).toEqual(["media/playing"]);
  });
});
