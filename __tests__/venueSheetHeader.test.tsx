import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueInspectorHeader from "@/components/map/inspector/VenueInspectorHeader";
import { tabsForVenue, type TabKey } from "@/lib/venueInspectorTabs";
import type { Venue } from "@/lib/venues";

/**
 * The venue sheet's head, as the site audit of 13 Sep 2026 measured it (D10,
 * D21): a kicker that read "Venue Detail", a label rather than brand, and seven
 * tabs in two rows on a 390px phone. Captain's law: kickers above headings are
 * brand and stay, so the kicker says where the pub is and what it is. The
 * rendered row and the slim empty photo are measured in the browser, in
 * e2e/mobile-venue-sheet-tabs.spec.ts and e2e/venue-tabs-fit.spec.ts.
 */

const hatton = {
  id: "venue-1vle947",
  name: "The Sir Christopher Hatton",
  address: "4 Leather Lane, Holborn, EC1N 7RA, London",
  primaryBorough: "Camden",
  kind: "pub",
  latitude: 51.5196,
  longitude: -0.1087,
  imageUrl: null,
} as unknown as Venue;

function renderHeader(venue: Venue): string {
  const tabs = tabsForVenue(venue.kind);
  return renderToStaticMarkup(
    createElement(VenueInspectorHeader, {
      venue,
      TABS: tabs,
      tab: "overview" as TabKey,
      tabRefs: { current: {} as Record<TabKey, HTMLButtonElement | null> },
      selectTab: () => {},
      onTabKeyDown: () => {},
    }),
  );
}

describe("the venue sheet kicker is brand, not a label", () => {
  it("says the pub's area and kind", () => {
    const html = renderHeader(hatton);
    expect(html).toContain('<div class="inspectorTitle"><span>Camden · Pub</span></div>');
    expect(html).not.toContain("Venue Detail");
  });

  it("names a non-pub by its own kind", () => {
    const html = renderHeader({ ...hatton, kind: "bar" } as Venue);
    expect(html).toContain("<span>Camden · Bar</span>");
  });
});

describe("the tab strip holds five tabs", () => {
  it("renders five tabs for a pub", () => {
    const html = renderHeader(hatton);
    expect(html.match(/role="tab"/g)).toHaveLength(5);
  });
});
