import type { Route } from "next";
import { describe, expect, it } from "vitest";
import { buildTabs, shouldShowMobileTabBar } from "@/components/nav/MobileTabBar";
import { navPathMatches } from "@/components/nav/navigationModel";
import { socialSurfaceName } from "@/lib/socialLaunch";
import { defined } from "@/__tests__/helpers/defined";

// Five-tab contract for the mobile bar, in the order of the loop: Explore,
// Tonight, Plan, Social, You (captain, 1 Nov 2026, launch plan decision 13;
// Social by the captain's call, 16 Oct 2026). Explore is the map and routes to
// /map. Out folded into Tonight (/out 308s there at the edge) and Places is the
// city setting reached from the map's chip, so neither is a tab. Moment is a
// compose action, never a destination, and nothing but the five tabs rides in
// the row. The URL preserves each explicit Day | Tonight choice. Both pages
// belong to the Tonight tab.

function activeLabel(pathname: string): string | undefined {
  const tabs = buildTabs();
  return tabs.find((tab) => navPathMatches(pathname, tab.match ?? [tab.href]))?.label;
}

describe("mobile tab bar contract", () => {
  it("shows the app tab bar on every route, including the landing pathname", () => {
    expect(shouldShowMobileTabBar("/")).toBe(true);
    expect(shouldShowMobileTabBar("/pal/chat")).toBe(true);
    expect(shouldShowMobileTabBar("/near")).toBe(true);
    expect(shouldShowMobileTabBar("/map")).toBe(true);
    expect(shouldShowMobileTabBar("/plan")).toBe(true);
    expect(shouldShowMobileTabBar("/places")).toBe(true);
    expect(shouldShowMobileTabBar("/area/clapham/drink/guinness")).toBe(true);
  });

  it("renders exactly five tabs in the loop order", () => {
    const tabs = buildTabs();
    expect(tabs.map((tab) => tab.label)).toEqual(["Explore", "Tonight", "Plan", "Social", "You"]);
    expect(tabs.map((tab) => tab.key)).toEqual(["map", "now", "plan", "social", "you"]);
  });

  it("names every tab on the link itself, so hiding the word at large text costs nothing", () => {
    for (const tab of buildTabs()) expect(tab.ariaLabel).toBe(tab.label);
    for (const tab of buildTabs()) expect(tab.preview).toBe(false);
  });

  it("names Social for its launch state without cutting the word short", () => {
    // "Social preview" does not fit a fifth of a 320px bar, so the dock shows
    // "Social" with the preview dot and the link carries the full name.
    const social = buildTabs("/u/you" as Route, "/map", socialSurfaceName(false)).find(
      (tab) => tab.key === "social",
    );
    expect(social).toMatchObject({ label: "Social", ariaLabel: "Social preview", preview: true, href: "/social" });
  });

  it("keeps Moment, Places and Out out of the dock", () => {
    const tabs = buildTabs();
    expect(tabs.some((tab) => tab.label === "Moment")).toBe(false);
    expect(tabs.some((tab) => tab.href.startsWith("/moment"))).toBe(false);
    expect(tabs.map((tab) => tab.key as string)).not.toContain("moment");
    expect(tabs.some((tab) => tab.href.startsWith("/places"))).toBe(false);
    expect(tabs.some((tab) => tab.href.startsWith("/out"))).toBe(false);
  });

  it("routes every tab to its owned destination", () => {
    const tabs = buildTabs();
    const byLabel = Object.fromEntries(tabs.map((tab) => [tab.label, tab]));
    expect(defined(byLabel.Tonight).href).toBe("/tonight");
    expect(defined(byLabel.Tonight).match).toEqual(["/today", "/tonight"]);
    expect(defined(byLabel.Explore).href).toBe("/map");
    expect(defined(byLabel.Explore).match).toEqual(["/map"]);
    expect(defined(byLabel.Plan).href).toBe("/plan");
    expect(defined(byLabel.Social).href).toBe("/social");
    expect(defined(byLabel.You).href).toBe("/u/you");
  });

  it("accepts the automatic daytime destination without changing the tab name", () => {
    expect(buildTabs("/u/you" as Route, "/map", "Social", "/today").find((tab) => tab.key === "now"))
      .toMatchObject({ href: "/today", label: "Tonight", ariaLabel: "Tonight" });
  });

  it("accepts the preferred-city Explore destination", () => {
    const tabs = buildTabs("/u/you" as Route, "/map/glasgow" as Route);
    expect(tabs.find((tab) => tab.label === "Explore")?.href).toBe("/map/glasgow");
  });

  it("points You at the device handle when known (skips /u/you sentinel hop)", () => {
    const tabs = buildTabs("/u/karan" as Route);
    const you = tabs.find((tab) => tab.label === "You");
    expect(you?.href).toBe("/u/karan");
    expect(you?.match).toEqual(["/u"]);
  });

  it("marks each door on its own routes, and the folded doors light nothing", () => {
    expect(activeLabel("/today")).toBe("Tonight");
    expect(activeLabel("/today/highlights")).toBe("Tonight");
    expect(activeLabel("/tonight")).toBe("Tonight");
    expect(activeLabel("/plan")).toBe("Plan");
    expect(activeLabel("/plan/abc123")).toBe("Plan");
    // /out never renders (it 308s to /tonight) and /places is a setting.
    expect(activeLabel("/out")).toBeUndefined();
    expect(activeLabel("/places")).toBeUndefined();
    expect(activeLabel("/choose-city")).toBeUndefined();
    expect(activeLabel("/social")).toBe("Social");
    expect(activeLabel("/feed")).toBe("Social");
    expect(activeLabel("/crawls/soho")).toBe("Plan");
    expect(activeLabel("/crawls")).toBe("Plan");
    expect(activeLabel("/moment")).toBeUndefined();
    expect(activeLabel("/map")).toBe("Explore");
    expect(activeLabel("/map/manchester")).toBe("Explore");
    // The Pal is a door in the top bar, never a tab, so its page lights none.
    expect(activeLabel("/pal")).toBeUndefined();
  });
});
