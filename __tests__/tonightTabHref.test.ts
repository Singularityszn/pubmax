import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { primaryNavKeyForPath } from "@/components/nav/navigationModel";

// The Now tab became Tonight (#1655). It used to keep both /today and /tonight
// live and flip the TAB href across 17:00 Europe/London, which meant a clock in
// the nav model, a separate server snapshot for the prerendered documents the
// CDN holds for an hour, and a timer in every bar that drew it. The word and
// the page agree at every hour now: the tab reads "Tonight", opens /tonight,
// and the daytime door is the page's own Day | Tonight segment.
//
// This is the same promise the old href test owned, stated for the tab that
// replaced it: ONE href, whatever the clock says, so a document built at 16:30
// and hydrated at 17:10 can never meet a bar that disagrees with it.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** The primary nav's Tonight entry, read fresh at `instant`. */
async function tonightTab(instant: string) {
  vi.setSystemTime(new Date(instant));
  vi.resetModules();
  const { PRIMARY_NAV_ITEMS } = await import("@/components/nav/navigationModel");
  const tab = PRIMARY_NAV_ITEMS.find((item) => item.key === "now");
  expect(tab, "the primary nav's Tonight entry").toBeDefined();
  return tab!;
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("the Tonight tab's href", () => {
  it("reads Tonight and opens /tonight", () => {
    // The word and the page agree, which is the whole reason the flip went.
    expect(primaryNavKeyForPath("/tonight")).toBe("now");
  });

  it.each([
    ["11:00 GMT, the old daytime half", "2026-01-15T11:00:00Z"],
    ["17:00 GMT, the old winter cut", "2026-01-15T17:00:00Z"],
    ["16:59 BST, one minute short of the old summer cut", "2026-08-16T15:59:00Z"],
    ["17:00 BST, the old summer cut", "2026-08-16T16:00:00Z"],
    ["23:59 BST, the far side of the evening", "2026-08-16T22:59:00Z"],
  ])("is /tonight at %s", async (_label, instant) => {
    vi.useFakeTimers();
    const tab = await tonightTab(instant);
    expect(tab.href).toBe("/tonight");
    expect(tab.label).toBe("Tonight");
  });

  it("still lights the tab on the daytime page it no longer points at", () => {
    // /today keeps its place in the match set: a reader on the day board is
    // still inside this destination, so the tab may not go dark there.
    expect(primaryNavKeyForPath("/today")).toBe("now");
    expect(primaryNavKeyForPath("/today/highlights")).toBe("now");
  });

  it("leaves no clock in the nav model or in the bars that draw it", () => {
    // A server snapshot, a subscription and a re-arming timer existed only to
    // serve an href that moved twice a day. Re-adding any of them re-opens the
    // hydration mismatch on the prerendered /, /map and landing documents.
    for (const file of [
      "components/nav/navigationModel.ts",
      "components/nav/MobileTabBar.tsx",
      "components/nav/SiteNav.tsx",
    ]) {
      const source = read(file);
      expect(source, `${file} must read no clock for the tab`).not.toContain(
        "nowTabHref",
      );
      expect(source, `${file} must not re-arm a tab-href timer`).not.toContain(
        "msUntilNowTabFlip",
      );
    }
    expect(read("components/nav/navigationModel.ts")).not.toContain("Date");
  });
});
