// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  FocusTrapOwner,
  shouldEngageFocusTrap,
  shouldInertOutsideSibling,
} from "@/lib/useFocusTrap";

// D2 — the desktop Pint Drop dead end. The phone sheet portal stays mounted at
// desktop widths with `display: none`. Its "moment" sheet opens at the `full`
// detent, so the trap inerted the whole desktop app: the toolbar search input
// could not take focus (activeElement stayed BODY) and the visible desktop
// picker's own rows were unclickable.
describe("shouldEngageFocusTrap", () => {
  it("never traps for a container CSS has hidden", () => {
    expect(
      shouldEngageFocusTrap({
        active: true,
        // section → .mobileSheetPortal (display:none above 640px) → body → html
        displayChain: ["flex", "none", "block", "block"],
      }),
    ).toBe(false);
  });

  it("traps for a container that is on screen", () => {
    expect(
      shouldEngageFocusTrap({
        active: true,
        displayChain: ["flex", "flex", "block", "block"],
      }),
    ).toBe(true);
  });

  it("never traps while inactive", () => {
    expect(
      shouldEngageFocusTrap({ active: false, displayChain: ["flex", "block"] }),
    ).toBe(false);
  });
});

describe("shouldInertOutsideSibling", () => {
  function el(className: string): HTMLElement {
    return {
      classList: { contains: (token: string) => className.split(/\s+/).includes(token) },
    } as HTMLElement;
  }

  it("keeps the primary tab bar interactive beside a map sheet", () => {
    expect(shouldInertOutsideSibling(el("mobileTabBar"), "map-surface")).toBe(false);
    expect(shouldInertOutsideSibling(el("appShell mapStage"), "map-surface")).toBe(true);
  });

  it("keeps account setup above an open map sheet interactive", () => {
    expect(
      shouldInertOutsideSibling(el("accountOnboardingBackdrop"), "map-surface"),
    ).toBe(false);
  });

  it("keeps the non-modal Android install card tappable beside a map sheet", () => {
    expect(
      shouldInertOutsideSibling(el("a2hsSheet a2hsSheet--android"), "map-surface"),
    ).toBe(false);
    // The iOS instructions are their own modal over a scrim, not a card.
    expect(shouldInertOutsideSibling(el("a2hsScrim"), "map-surface")).toBe(true);
    expect(
      shouldInertOutsideSibling(el("a2hsSheet a2hsSheet--android"), "strict-modal"),
    ).toBe(true);
  });

  it("inerts every outside sibling for a strict modal", () => {
    expect(shouldInertOutsideSibling(el("mobileTabBar"), "strict-modal")).toBe(true);
    expect(
      shouldInertOutsideSibling(el("accountOnboardingBackdrop"), "strict-modal"),
    ).toBe(true);
  });
});

describe("FocusTrapOwner", () => {
  function componentOwnedNode(inert = false): HTMLElement {
    const element = document.createElement("div");
    // jsdom does not reflect HTMLElement.inert to its attribute like Chromium.
    Object.defineProperty(element, "inert", {
      get: () => element.hasAttribute("inert"),
      set: (value: boolean) => {
        if (value) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
      },
    });
    element.inert = inert;
    return element;
  }


  for (const cleanup of ["release", "reconcile"] as const) {
    it(`does not reinstate a drawer's cleared inert state on ${cleanup}`, () => {
      const drawer = componentOwnedNode(true);
      const trap = new FocusTrapOwner();
      trap.reconcile([drawer]);

      // Opening the drawer clears its own inert prop before effect cleanup.
      drawer.inert = false;
      if (cleanup === "release") trap.release();
      else trap.reconcile([]);

      expect(drawer.inert).toBe(false);
    });

    it(`preserves an unchanged pre-existing inert state on ${cleanup}`, () => {
      const drawer = componentOwnedNode(true);
      const trap = new FocusTrapOwner();
      trap.reconcile([drawer]);

      if (cleanup === "release") trap.release();
      else trap.reconcile([]);

      expect(drawer.inert).toBe(true);
    });
  }

  for (const firstRelease of ["map", "strict"] as const) {
    it(`keeps an overlapping trap inert when ${firstRelease} releases first`, () => {
      const outside = componentOwnedNode();
      const map = new FocusTrapOwner();
      const strict = new FocusTrapOwner();

      map.reconcile([outside]);
      strict.reconcile([outside]);
      (firstRelease === "map" ? map : strict).release();

      expect(outside.inert).toBe(true);

      (firstRelease === "map" ? strict : map).release();

      expect(outside.inert).toBe(false);
    });
  }

  for (const firstRelease of ["map", "strict"] as const) {
    for (const cleanup of ["release", "reconcile"] as const) {
      it(`keeps an opened drawer live after overlapping ${firstRelease} ${cleanup}`, () => {
        const drawer = componentOwnedNode(true);
        const map = new FocusTrapOwner();
        const strict = new FocusTrapOwner();
        map.reconcile([drawer]);
        strict.reconcile([drawer]);

        // SpringDrawer opens while both traps still claim its former inert node.
        drawer.inert = false;
        const first = firstRelease === "map" ? map : strict;
        const second = firstRelease === "map" ? strict : map;
        if (cleanup === "release") first.release();
        else first.reconcile([]);
        expect(drawer.inert).toBe(true);

        second.release();
        expect(drawer.inert).toBe(false);
      });
    }
  }

  for (const [initiallyInert, componentInert] of [
    [true, false],
    [false, true],
  ] as const) {
    for (const firstRelease of ["map", "strict"] as const) {
      for (const cleanup of ["release", "reconcile"] as const) {
        it(`keeps component ${componentInert ? "closed" : "open"} after async observer delivery and overlapping ${firstRelease} ${cleanup}`, async () => {
          const drawer = componentOwnedNode(initiallyInert);
          const map = new FocusTrapOwner();
          const strict = new FocusTrapOwner();
          map.reconcile([drawer]);
          strict.reconcile([drawer]);

          drawer.inert = componentInert;
          await Promise.resolve();
          expect(drawer.inert).toBe(true);

          const first = firstRelease === "map" ? map : strict;
          const second = firstRelease === "map" ? strict : map;
          if (cleanup === "release") first.release();
          else first.reconcile([]);
          expect(drawer.inert).toBe(true);

          second.release();
          await Promise.resolve();
          expect(drawer.inert).toBe(componentInert);
        });
      }
    }
  }

  it("retains a component's newly closed drawer after both traps leave", () => {
    const drawer = componentOwnedNode(false);
    const map = new FocusTrapOwner();
    const strict = new FocusTrapOwner();
    map.reconcile([drawer]);
    strict.reconcile([drawer]);

    // The component asserts inert while the traps have already set it true.
    drawer.inert = true;
    map.release();
    expect(drawer.inert).toBe(true);
    strict.release();
    expect(drawer.inert).toBe(true);
  });

  it("uses the latest component state through trap cleanup and remount", () => {
    const drawer = componentOwnedNode(true);
    const first = new FocusTrapOwner();
    first.reconcile([drawer]);
    drawer.inert = false;
    first.release();
    expect(drawer.inert).toBe(false);

    const second = new FocusTrapOwner();
    second.reconcile([drawer]);
    drawer.inert = true;
    second.release();
    expect(drawer.inert).toBe(true);
  });

  it("restores the earlier map origin after overlapping teardown", () => {
    const mapOrigin = componentOwnedNode();
    const sheetOrigin = componentOwnedNode();
    mapOrigin.tabIndex = -1;
    sheetOrigin.tabIndex = -1;
    document.body.append(mapOrigin, sheetOrigin);
    sheetOrigin.focus();
    const map = new FocusTrapOwner();
    const strict = new FocusTrapOwner();

    map.captureFocus(mapOrigin);
    strict.captureFocus(sheetOrigin);
    strict.reconcile([mapOrigin]);

    map.release();

    expect(document.activeElement).toBe(sheetOrigin);

    sheetOrigin.remove();
    strict.release();

    expect(document.activeElement).toBe(mapOrigin);
    mapOrigin.remove();
  });
});
