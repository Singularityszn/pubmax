import { Color, createExpression } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";

import {
  CLUSTER_PRICE_KEY_NONE,
  CLUSTER_PRICE_KEY_PROPERTY,
  CLUSTER_PRICE_NONE,
  clusterLabelExpr,
} from "@/components/map/canvas/filters";
import { buildDonutMarkerSvg, clusterLabelText, readMinPriceBand } from "@/lib/donutClusterGeometry";

// Owner decision 16 Oct 2026: a cluster must stop contradicting its figure.
// It printed its cheapest price but wore the ring of its commonest band, so
// "£2.49" stood in the red "dear" ring. Now the disc is neutral and the one
// colour on it is the figure's OWN band ink (Price Band law: colour carries the
// band only). These tests run the real MapLibre expression evaluator over a
// simulated supercluster `min` reduce, so the GL disc is held to the claim.

const INK = "#101010";
const BAND_INK = ["#118811", "#888811", "#881111"] as const;

type Pub = { clusterPrice?: number; bucket: number };

const SPEC = {
  "property-type": "data-driven",
  expression: { interpolated: false, parameters: ["zoom", "feature"] },
} as const;

function compile(expression: unknown, type: string) {
  const compiled = createExpression(expression as never, { ...SPEC, type } as never);
  if (compiled.result !== "success") {
    throw new Error(`did not compile: ${JSON.stringify(compiled.value)}`);
  }
  return compiled.value;
}

/** supercluster's own reduce: `map` per pub, then the operator across them. */
function reduceCluster(pubs: Pub[]): Record<string, unknown> {
  const [, mapExpr] = CLUSTER_PRICE_KEY_PROPERTY as unknown as [string, unknown];
  const perPub = compile(mapExpr, "number");
  const keys = pubs.map((properties) =>
    Number(perPub.evaluate({ zoom: 12 } as never, { type: 1, properties } as never)),
  );
  const prices = pubs.map((pub) => pub.clusterPrice ?? CLUSTER_PRICE_NONE);
  return {
    minPrice: Math.min(...prices),
    minPriceKey: Math.min(...keys),
    point_count: pubs.length,
    point_count_abbreviated: String(pubs.length),
  };
}

type Section = { text: string; textColor: Color | null; scale: number | null };

function labelFor(pubs: Pub[]): Section[] {
  const label = compile(clusterLabelExpr(INK, BAND_INK), "formatted");
  const formatted = label.evaluate(
    { zoom: 12 } as never,
    { type: 1, properties: reduceCluster(pubs) } as never,
  ) as { sections: Section[] };
  return formatted.sections;
}

const colour = (hex: string) => Color.parse(hex)!.toString();
const figureSection = (sections: Section[]) => sections.at(-1)!;

describe("a cluster's figure wears its own band", () => {
  it("prints £2.49 in the cheap ink even when every other pub round it is dear", () => {
    const sections = labelFor([
      { clusterPrice: 2.49, bucket: 0 },
      { clusterPrice: 7.2, bucket: 2 },
      { clusterPrice: 7.5, bucket: 2 },
      { clusterPrice: 7.9, bucket: 2 },
      { bucket: 3 },
    ]);
    expect(sections.map((section) => section.text).join("")).toBe("from\n£2.49");
    expect(figureSection(sections).textColor?.toString()).toBe(colour(BAND_INK[0]));
    // "from" is ink, and smaller than the figure.
    expect(sections[0]!.textColor?.toString()).toBe(colour(INK));
    expect(sections[0]!.scale).toBeLessThan(1);
  });

  it.each([
    { band: 1, price: 5.9 },
    { band: 2, price: 7.1 },
  ])("prints a band-$band cheapest figure in band $band's ink", ({ band, price }) => {
    const sections = labelFor([
      { clusterPrice: price, bucket: band },
      { clusterPrice: price + 1, bucket: 2 },
    ]);
    expect(figureSection(sections).textColor?.toString()).toBe(colour(BAND_INK[band]!));
  });

  it("gives a tie on the figure to the cheaper band, never the dearer", () => {
    const sections = labelFor([
      { clusterPrice: 5.5, bucket: 1 },
      { clusterPrice: 5.5, bucket: 0 },
    ]);
    expect(figureSection(sections).textColor?.toString()).toBe(colour(BAND_INK[0]));
  });

  it("keeps a figure whose pub has no band in plain ink", () => {
    const sections = labelFor([{ clusterPrice: 4.5, bucket: 3 }, { bucket: 3 }]);
    expect(figureSection(sections).text).toBe("£4.50");
    expect(figureSection(sections).textColor?.toString()).toBe(colour(INK));
  });

  it("prints the count in ink where no pub in it says a price", () => {
    const sections = labelFor([{ bucket: 2 }, { bucket: 2 }, { bucket: 3 }]);
    expect(sections.map((section) => section.text).join("")).toBe("3");
    expect(figureSection(sections).textColor?.toString()).toBe(colour(INK));
  });

  it("reads the same band off the key on the desktop disc", () => {
    expect(readMinPriceBand(reduceCluster([{ clusterPrice: 2.49, bucket: 0 }, { clusterPrice: 8, bucket: 2 }]))).toBe(0);
    expect(readMinPriceBand(reduceCluster([{ clusterPrice: 7.1, bucket: 2 }]))).toBe(2);
    expect(readMinPriceBand({ minPriceKey: CLUSTER_PRICE_KEY_NONE })).toBeNull();
    expect(readMinPriceBand({})).toBeNull();
  });
});

describe("the desktop disc says the same thing", () => {
  const svg = (figure: string | null, figureColor = BAND_INK[0]) =>
    buildDonutMarkerSvg({
      counts: [1, 0, 3, 0],
      discColor: "#ffffff",
      casingColor: INK,
      trackColor: "#dddddd",
      textColor: INK,
      figureColor,
      outerRadius: 22,
      figure,
    });

  it("is a neutral disc: no band colour anywhere but the figure", () => {
    const markup = svg("£2.49");
    expect(markup).not.toContain("data-bucket");
    expect(markup.match(new RegExp(BAND_INK[0], "g"))).toHaveLength(1);
    expect(markup).toMatch(new RegExp(`fill="${BAND_INK[0]}"[^>]*data-role="figure">£2.49<`));
    expect(markup).toContain('data-role="ring"');
    expect(markup).toContain('stroke="#dddddd"');
  });

  it("reads from £x · n pubs, with the count under the disc", () => {
    const markup = svg("£2.49");
    expect(markup).toContain('aria-label="from £2.49 · 4 pubs"');
    expect(markup).toContain('data-role="from">from<');
    expect(markup).toContain('data-role="count">4 pubs<');
  });

  it("prints the count in ink, with nothing under it, where no pub says a price", () => {
    const markup = svg(null);
    expect(markup).toContain('aria-label="4 pubs"');
    expect(markup).not.toContain('data-role="from"');
    expect(markup).not.toContain('data-role="count"');
    expect(markup).not.toContain(BAND_INK[0]);
  });

  it("words the label the one way", () => {
    expect(clusterLabelText("£4.85", 12)).toBe("from £4.85 · 12 pubs");
    expect(clusterLabelText(null, 1500)).toBe("1.5k pubs");
  });
});
