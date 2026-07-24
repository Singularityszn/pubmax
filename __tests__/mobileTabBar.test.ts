import { describe, expect, it } from "vitest";
import { buildTabs, tourSpotlightColumn } from "@/components/nav/MobileTabBar";
import { TOUR_TARGET_TAB_KEY, navPathMatches } from "@/components/nav/navigationModel";

// Six-tab contract for the mobile bar (owner-locked journey order). The shared
// PRIMARY_NAV_ITEMS model stays four destinations by its own contract test;
// Today and Moment are injected by the bar, so THIS test locks what a thumb
// actually meets: order, destinations, and the centre action.

function activeLabel(pathname: string, mapHref = "/map"): string | undefined {
  const tabs = buildTabs(mapHref, pathname);
  return tabs.find((tab) => !tab.primary && navPathMatches(pathname, tab.match ?? [tab.href]))?.label;
}

describe("mobile tab bar contract", () => {
  it("renders exactly six tabs in the journey order", () => {
    const tabs = buildTabs("/map", "/tonight");
    expect(tabs.map((tab) => tab.label)).toEqual([
      "Today",
      "Map",
      "Moment",
      "Tonight",
      "Stories",
      "You",
    ]);
  });

  it("routes every tab to its owned destination", () => {
    const tabs = buildTabs("/map/london", "/tonight");
    const byLabel = Object.fromEntries(tabs.map((tab) => [tab.label, tab]));
    expect(byLabel.Today.href).toBe("/today");
    // Map follows the preferred city.
    expect(byLabel.Map.href).toBe("/map/london");
    expect(byLabel.Moment.href).toBe("/moment?returnTo=%2Ftonight");
    expect(byLabel.Tonight.href).toBe("/tonight");
    expect(byLabel.Stories.href).toBe("/feed");
    expect(byLabel.You.href).toBe("/u/you");
  });

  it("points You at the device handle when known (skips /u/you sentinel hop)", () => {
    const tabs = buildTabs("/map", "/today", "/u/karan");
    const you = tabs.find((tab) => tab.label === "You");
    expect(you?.href).toBe("/u/karan");
    // Match stays /u so the tab still lights on the resolved profile.
    expect(you?.match).toEqual(["/u"]);
  });

  it("marks only Moment as the raised centre action, in the centre slot", () => {
    const tabs = buildTabs("/map", "/map");
    expect(tabs.filter((tab) => tab.primary).map((tab) => tab.label)).toEqual(["Moment"]);
    expect(tabs[2].label).toBe("Moment");
  });

  it("marks Stories active on /feed and the retired /stories alias", () => {
    expect(activeLabel("/feed")).toBe("Stories");
    expect(activeLabel("/stories")).toBe("Stories");
    expect(activeLabel("/discover")).toBe("Stories");
    expect(activeLabel("/crawls")).toBe("Stories");
    // Moment is a compose action, never a persistent location.
    expect(activeLabel("/moment")).toBeUndefined();
  });
});

// The first-run tour spotlight rings are positioned from the LIVE tab geometry
// (tourSpotlightColumn → buildTabs), so the ring can never drift off its tab.
// Lock the exact columns each tour target resolves to: a future 7th tab — or a
// reorder — that shifts "map" / Moment / "stories" out of these slots fails
// here, forcing the tour copy + geometry to be reconsidered in lockstep.
describe("first-run tour spotlight geometry", () => {
  const tabs = buildTabs("/map", "/map");

  it("maps each tour target to the tab key it names", () => {
    expect(TOUR_TARGET_TAB_KEY).toEqual({ map: "map", drop: "moment", discover: "stories" });
  });

  it("anchors 'map' to the Map column", () => {
    const { index, total } = tourSpotlightColumn("map");
    expect(total).toBe(6);
    expect(index).toBe(1);
    expect(tabs[index]!.label).toBe("Map");
  });

  it("anchors 'drop' to the Moment centre column", () => {
    const { index, total } = tourSpotlightColumn("drop");
    expect(total).toBe(6);
    expect(index).toBe(2);
    expect(tabs[index]!.label).toBe("Moment");
    expect(tabs[index]!.primary).toBe(true);
  });

  it("anchors 'discover' to the Stories column", () => {
    const { index, total } = tourSpotlightColumn("discover");
    expect(total).toBe(6);
    expect(index).toBe(4);
    expect(tabs[index]!.label).toBe("Stories");
  });
});
