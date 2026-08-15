import { describe, expect, it } from "vitest";

import {
  shouldEngageFocusTrap,
  shouldInertOutsideSibling,
  strictModalAllowsSurfaceRequest,
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

  it("inerts every outside sibling for a strict modal", () => {
    expect(shouldInertOutsideSibling(el("mobileTabBar"), "strict-modal")).toBe(true);
    expect(
      shouldInertOutsideSibling(el("accountOnboardingBackdrop"), "strict-modal"),
    ).toBe(true);
  });
});

describe("strictModalAllowsSurfaceRequest", () => {
  it("refuses a late-mounted sibling while a strict modal is active", () => {
    expect(
      strictModalAllowsSurfaceRequest({
        requestRevision: 1,
        strictModalActive: true,
        strictModalRevision: 1,
      }),
    ).toBe(false);
  });

  it("does not reopen a request from before the strict modal", () => {
    expect(
      strictModalAllowsSurfaceRequest({
        requestRevision: 1,
        strictModalActive: false,
        strictModalRevision: 2,
      }),
    ).toBe(false);
    expect(
      strictModalAllowsSurfaceRequest({
        requestRevision: 2,
        strictModalActive: false,
        strictModalRevision: 2,
      }),
    ).toBe(true);
  });
});
