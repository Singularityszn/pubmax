import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// The first-visit card after the 7 Sep live walk (B1). Two separate defects
// were behind one reading of `probePins=0`.
//
// (1) THE MAP WAS INERT. `interactionLocked` put `inert` on `.mapCanvasWrap`
//     and on `.mobileMapChrome`, so `elementFromPoint` answered the ancestor
//     at every point on the canvas and no pin was tappable anywhere, not only
//     under the card. A card the reader must dismiss before the map works is
//     not an arrival, it is a door.
// (2) IT SAT ON THE PINS. Measured at 390x844: y 533 to 768, over the densest
//     part of central London.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const cardSource = read("components/map/MapArrivalCard.tsx");
const cardCss = read("components/map/mapArrivalCard.css");
const pubMapSource = read("components/PubMap.tsx");
const canvasSource = read("components/PubMapCanvas.tsx");
const shellSource = read("components/mobile/MobileMapShell.tsx");

describe("the first-visit card leaves the map usable", () => {
  it("locks nothing: no interaction lock is passed or read", () => {
    expect(pubMapSource).not.toContain("interactionLocked");
    expect(canvasSource).not.toContain("interactionLocked");
    expect(shellSource).not.toContain("interactionLocked");
  });

  it("clears itself on the reader's first move on the map", () => {
    expect(cardSource).toContain("onMapGestureDismiss");
    expect(pubMapSource).toContain("dismissMapFirstVisitArrivalOnMapUse");
  });
});

describe("the first-visit card is a strip at the top on a phone", () => {
  it("docks under the phone's own chrome rather than over the pins", () => {
    expect(cardCss).toMatch(/\.mapArrivalCard\s*\{[^}]*top:/);
    expect(cardCss).toContain("--mobile-map-chrome-full-h");
    // The old berth pinned it to the foot of the screen.
    expect(cardCss).not.toMatch(/\.mapArrivalCard\s*\{[^}]*bottom:\s*var\(\s*--map-arrival-bottom/);
  });

  it("paints its one primary in the product's coral, like every other screen", () => {
    const primary = cardCss.match(/\.mapArrivalCardPrimary\s*\{[^}]*\}/)?.[0] ?? "";
    expect(primary).toContain("var(--color-accent)");
    expect(primary).toContain("var(--color-on-accent)");
    expect(primary).not.toContain("var(--ink)");
  });

  it("drops the eyebrow, and keeps the sentence the App Store copy is paired to", () => {
    // "FIRST VISIT" is decoration: the card's own accessible name already says
    // it. The location sentence STAYS. docs/proof/mobile-app-design/
    // STORE_READINESS.md records it as the visible half of a pair with the iOS
    // purpose string, so cutting it for a shorter strip would break a claim
    // made to the store rather than tidy a card.
    expect(cardSource).not.toContain("mapArrivalCardEyebrow");
    expect(cardSource).toContain("Location is used only while the map is open");
  });

  it("is capped short enough that the pin field is never under it", () => {
    const card = cardCss.match(/\.mapArrivalCard\s*\{[^}]*\}/)?.[0] ?? "";
    expect(card).toContain("--map-arrival-strip-max-h");
  });
});

describe("the phone chrome no longer steps around a card at the foot", () => {
  const shellCss = read("components/mobile/mobileMapShell.css");

  it("stops hiding the chip row, the plan pill and the map-edge column", () => {
    expect(shellCss).not.toMatch(
      /body:has\(\.mapArrivalCard\)[\s\S]{0,400}?\.mobileMapChipRow/,
    );
    expect(shellCss).not.toMatch(
      /body:has\(\.mapArrivalCard\)[\s\S]{0,400}?\.mobilePlanActivation/,
    );
  });
});
