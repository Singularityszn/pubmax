import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueInspectorHeader from "@/components/map/inspector/VenueInspectorHeader";
import { tabsForVenue, type TabKey } from "@/lib/venueInspectorTabs";
import type { Venue } from "@/lib/venues";

/**
 * The venue sheet's head, as the site audit of 13 Sep 2026 measured it (D10,
 * D21): a kicker that read "Venue Detail", a label rather than brand; a 220px
 * "No photo yet" box that was the largest thing on the sheet of a pub with no
 * photo; and seven tabs in two rows on a 390px phone. Captain's law: kickers
 * above headings are brand and stay, so the kicker says where the pub is and
 * what it is.
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
  const tabs = tabsForVenue("london", venue.kind);
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

const sheetCss = readFileSync(
  path.join(__dirname, "..", "components/map/venueSheet.css"),
  "utf8",
);

/** Every rule body for `selector` inside a `@media (max-width: <width>px)` block. */
function phoneRules(selector: string): string[] {
  const bodies: string[] = [];
  const media = /@media \(max-width: (640|430)px\)\s*{/g;
  while (media.exec(sheetCss) !== null) {
    let depth = 1;
    let index = media.lastIndex;
    while (depth > 0 && index < sheetCss.length) {
      if (sheetCss[index] === "{") depth += 1;
      if (sheetCss[index] === "}") depth -= 1;
      index += 1;
    }
    const block = sheetCss.slice(media.lastIndex, index - 1);
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = new RegExp(`(?:^|[\\s,}])${escaped}\\s*{([^}]*)}`, "g");
    let found: RegExpExecArray | null;
    while ((found = rule.exec(block))) bodies.push(found[1]);
  }
  return bodies;
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

describe("the tab strip is one row of five", () => {
  it("renders five tabs for a pub", () => {
    const html = renderHeader(hatton);
    expect(html.match(/role="tab"/g)).toHaveLength(5);
  });

  it("never wraps the strip into a second row on a phone", () => {
    const strips = phoneRules(".venueTabs");
    expect(strips.length).toBeGreaterThan(0);
    for (const body of strips) expect(body).not.toMatch(/flex-wrap:\s*wrap/);
  });

  it("shares the row equally so no tab hangs past the edge", () => {
    expect(phoneRules(".venueTab").some((body) => /flex:\s*1 1 0/.test(body))).toBe(true);
  });
});

describe("a pub with no photo gets a row, not a box", () => {
  it("renders the empty header photo as a 56px row", () => {
    const rule = sheetCss.match(/\.venueBaselinePhoto\.venueImage--empty\s*{([^}]*)}/)?.[1] ?? "";
    expect(rule).toMatch(/aspect-ratio:\s*auto/);
    expect(rule).toMatch(/height:\s*56px/);
  });
});
