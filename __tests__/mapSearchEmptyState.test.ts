import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
const styles = readFileSync(join(process.cwd(), "components/map/mapSearchEmpty.module.css"), "utf8");

describe("map search empty state", () => {
  it("counts the forced selected venue when deciding whether pin paint needs a retry", () => {
    expect(pubMap).toContain("withForcedVenue(kindVisibleMapVenues, venueById, selectedVenueId)");
    expect(pubMap).toMatch(/<PubMapCanvas\s+venues=\{canvasVenues\}\s+filteredVenueCount=\{canvasVenues.length\}/);
  });

  it("names the query and offers a query-only recovery action", () => {
    expect(pubMap).toContain('data-testid="map-filter-empty"');
    expect(pubMap).toContain("No pubs match &apos;{trimmedMapQuery}&apos; here");
    expect(pubMap).toContain("searchEmptyStyles.mapSearchEmptyAction");
    expect(pubMap).toContain("onClick={clearMapQuery}");
    expect(pubMap).toContain("filteredPubVenueCount > 0");
    expect(pubMap).toContain("!mapListOpen");
    expect(pubMap).toContain("visibleMapPinCount === 0");
  });

  it("uses the map tokens and a full-size action target", () => {
    const endIdx = styles.indexOf("/* WebGL-failure fallback", styles.indexOf(".mapSearchEmpty {"));
    const emptyBlock = styles.slice(
      styles.indexOf(".mapSearchEmpty {"),
      endIdx > 0 ? endIdx : undefined,
    );

    expect(emptyBlock).toContain("var(--panel-raised)");
    expect(emptyBlock).toContain("var(--state-active-border)");
    expect(emptyBlock).toContain("min-height: var(--control-height)");
    expect(emptyBlock).toContain("var(--color-accent)");
    expect(emptyBlock).toContain("var(--z-map-ask");
  });
});
