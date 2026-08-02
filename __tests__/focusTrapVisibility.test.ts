import { describe, expect, it } from "vitest";

import { shouldEngageFocusTrap } from "@/lib/useFocusTrap";

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
