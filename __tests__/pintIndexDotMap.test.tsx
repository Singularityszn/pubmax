import { describe, expect, it } from "vitest";

import Image from "@/app/pint-index/opengraph-image";
import EditionImage from "@/app/pint-index/[month]/opengraph-image";
import { LONDON_BOROUGH_NAMES, boroughCode, type PintIndexSnapshot } from "@/lib/pintIndex";
import { DOT_BAND_FILL, PintIndexDotMap, boroughBands, londonDotLattice } from "@/lib/pintIndexDotMap";
import { OG, OG_CACHE_HEADERS } from "@/lib/ogBrand";
import { priceBandThresholdsFor } from "@/lib/priceBand";

// The Index share cards draw London as a dot picture (lib/pintIndexDotMap.tsx).
// These pin its three rules: every dot is in a real borough, only a cited
// price lights a dot, and the band is the one band rule's answer.

function snapshotWith(prices: Record<string, number>): PintIndexSnapshot {
  const observations = Object.entries(prices).map(([boroughName, pricePence], index) => ({
    venueId: `venue-${index}`,
    pubName: `Pub ${index}`,
    boroughCode: boroughCode(boroughName),
    boroughName: boroughName as PintIndexSnapshot["observations"][number]["boroughName"],
    pricePence,
    observedAt: "2026-10-01T12:00:00Z",
    sourceId: "source-1",
  }));
  return { observations } as unknown as PintIndexSnapshot;
}

describe("the London dot lattice", () => {
  const lattice = londonDotLattice(500, 11);

  it("puts at least one dot in every one of the 33 boroughs, and only there", () => {
    const seen = new Set(lattice.dots.map((dot) => dot.borough));
    expect([...seen].sort()).toEqual([...LONDON_BOROUGH_NAMES].sort());
  });

  it("keeps every dot inside the drawing", () => {
    for (const dot of lattice.dots) {
      expect(dot.x).toBeGreaterThan(0);
      expect(dot.x).toBeLessThan(lattice.width);
      expect(dot.y).toBeGreaterThan(0);
      expect(dot.y).toBeLessThan(lattice.height);
    }
  });

  it("is computed once per size", () => {
    expect(londonDotLattice(500, 11)).toBe(lattice);
  });
});

describe("which dots are lit", () => {
  it("lights nothing for a snapshot with no cited price, or no snapshot", () => {
    expect(boroughBands(snapshotWith({})).size).toBe(0);
    expect(boroughBands(null).size).toBe(0);
  });

  it("bands a borough by its average against London's terciles", () => {
    const { cheapMaxGbp, averageMaxGbp } = priceBandThresholdsFor({ city: "london" });
    const bands = boroughBands(
      snapshotWith({
        Bexley: Math.round(cheapMaxGbp * 100) - 50,
        Hackney: Math.round(averageMaxGbp * 100),
        Westminster: Math.round(averageMaxGbp * 100) + 120,
      }),
    );
    expect(Object.fromEntries(bands)).toEqual({
      Bexley: "cheap",
      Hackney: "average",
      Westminster: "expensive",
    });
  });

  it("paints a lit borough in its band hue and leaves the rest dim", () => {
    const svg = PintIndexDotMap({ snapshot: snapshotWith({ Camden: 900 }) });
    const circles = (svg.props.children as Array<{ props: { fill: string } }>).map((c) => c.props.fill);
    const camdenDots = londonDotLattice(500, 11).dots.filter((dot) => dot.borough === "Camden").length;
    expect(circles.filter((fill) => fill === DOT_BAND_FILL.expensive)).toHaveLength(camdenDots);
    expect(circles.filter((fill) => fill === OG.muted)).toHaveLength(circles.length - camdenDots);
  });
});

describe("the Index share cards", () => {
  it("render a PNG with the live-card cache header", async () => {
    const response = await Image();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(OG_CACHE_HEADERS["cache-control"]);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
  });

  it("still answer 404 for an unpublished edition", async () => {
    const response = await EditionImage({ params: Promise.resolve({ month: "1999-01" }) });
    expect(response.status).toBe(404);
  });
});
