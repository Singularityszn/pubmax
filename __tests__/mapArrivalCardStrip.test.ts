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
    // PubMap owns it, because the gesture and the pin tap both arrive there:
    // `dismissAmbientBanners` is the canvas's reader-gesture callback, and
    // `handleVenueClick` is the pin.
    expect(pubMapSource).toMatch(
      /const dismissAmbientBanners = useCallback\(\(\) => \{[\s\S]{0,400}?dismissMapFirstVisitArrivalOnMapUse\(\)/,
    );
    expect(pubMapSource).toMatch(
      /const handleVenueClick = useCallback\([\s\S]{0,500}?dismissMapFirstVisitArrivalOnMapUse\(\)/,
    );
    // And a finger on open water counts too: somebody looking at the map has
    // answered, whatever the tap landed on.
    expect(pubMapSource).toContain(
      "onReaderTouchedMap={dismissMapFirstVisitArrivalOnMapUse}",
    );
    expect(canvasSource).toContain("onPointerDownCapture={onReaderTouchedMap}");
    // It takes NO arguments, because it is handed straight to a React event
    // prop: a `storage` parameter would receive the pointer event, `setItem`
    // would throw on it, and the catch would swallow the dismissal in silence.
    expect(read("lib/mapFirstVisitArrival.ts")).toContain(
      "export function dismissMapFirstVisitArrivalOnMapUse(): void {",
    );
  });
});

describe("the first-visit card is a strip at the top on a phone", () => {
  it("reads the phone chrome's MEASURED bottom, not only its resting berth", () => {
    // Anchored to the published berth alone the strip landed at y 120 with the
    // chip row's own bottom at 215, so "Pints" read through it.
    expect(cardCss).toContain("--mobile-map-chrome-measured-h");
    expect(read("components/mobile/MobileMapShell.tsx")).toContain(
      "usePublishedChromeHeight",
    );
  });

  it("docks under the phone's own chrome rather than over the pins", () => {
    expect(cardCss).toMatch(/\.mapArrivalCard\s*\{[^}]*top:/);
    expect(cardCss).toContain("--mobile-map-chrome-full-h");
    // The old berth pinned it to the foot of the screen.
    expect(cardCss).not.toMatch(/\.mapArrivalCard\s*\{[^}]*bottom:\s*var\(\s*--map-arrival-bottom/);
  });

  it("yields to a panel the reader opens from the toolbar", () => {
    // Measured at 1440x900: the strip spans x 380 to 1060 and the Filters
    // popover opens at x 503 to 863, straight through the middle of it. The
    // strip stayed painted either side of the panel and read as a card cut in
    // three. One surface at a time: the reader opening Filters has moved on
    // from the ask, and the strip comes back when the panel closes.
    expect(cardCss).toMatch(
      /body:has\(\.mapToolbar \[aria-expanded="true"\]\)[\s\S]{0,120}?\.mapArrivalCard[\s\S]{0,60}?display:\s*none/,
    );
  });

  it("is the only painted action while it is up", () => {
    // `Plan an outing` is the toolbar's own coral fill and it sat directly
    // above this strip's `Use my location` at 1440.
    expect(cardCss).toMatch(
      /body:has\(\.mapArrivalCard\)[\s\S]{0,120}?\.planBtn/,
    );
  });

  it("paints its pair with the one button family, not a look of its own", () => {
    // Site audit 13 Sep 2026 (D7): the pair wore --radius-sm (6px) at weight
    // 600 beside every other control's 14px at 700. The coral and the plain
    // secondary are the Button primitive's own variants now, so the strip may
    // not restate a radius, a type size, a weight or a fill for them.
    expect(cardSource).toMatch(/buttonVariants\(\{\s*variant:\s*"primary"\s*\}\)/);
    expect(cardSource).toMatch(/buttonVariants\(\{\s*variant:\s*"secondary"\s*\}\)/);
    const actions = cardCss.match(/\.mapArrivalCardActions button\s*\{[^}]*\}/g)?.join("\n") ?? "";
    expect(actions).not.toMatch(/border-radius|font-size|font-weight|background/);
    expect(cardCss).not.toMatch(/\.mapArrivalCard(Primary|Secondary)\s*\{/);
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
