import { describe, expect, it } from "vitest";

import {
  buildDonutMarkerSvg,
  buildDonutStrokeSegments,
  DONUT_BADGE_MIN,
  DONUT_CASING_PX,
  DONUT_RING_PX,
  donutOuterRadius,
  donutTotal,
  formatDonutCount,
  readMinPrice,
  type DonutCounts,
  type DonutMarkerSvgParams,
} from "@/lib/donutClusterGeometry";
import { defined } from "@/__tests__/helpers/defined";

const COLORS = ["#2f8f5b", "#d99f45", "#d16353", "#6b726a"];

describe("donutOuterRadius", () => {
  it("is one of two sizes by zoom, and never grows with the count", () => {
    // 44px below the street-band hand-off, 36px from it. The count is the small
    // number on the rim, so a bigger cluster is not a bigger disc.
    expect(donutOuterRadius(10.7)).toBe(22);
    expect(donutOuterRadius(12.99)).toBe(22);
    expect(donutOuterRadius(13)).toBe(18);
    expect(donutOuterRadius(13.9)).toBe(18);
  });
});

describe("readMinPrice", () => {
  it("reads the cheapest price a cluster's pubs say", () => {
    expect(readMinPrice({ minPrice: 5.4 })).toBe(5.4);
    expect(readMinPrice({ minPrice: "4.95" })).toBe(4.95);
  });

  it("answers null where no pub in the cluster says a price", () => {
    // 9999 is what a silent pub contributes to the `min`, so a cluster still at
    // it has nothing to claim and prints its count.
    expect(readMinPrice({ minPrice: 9999 })).toBeNull();
    expect(readMinPrice({})).toBeNull();
    expect(readMinPrice(null)).toBeNull();
    expect(readMinPrice({ minPrice: 0 })).toBeNull();
    expect(readMinPrice({ minPrice: -3 })).toBeNull();
    expect(readMinPrice({ minPrice: Number.NaN })).toBeNull();
  });
});

describe("donutTotal", () => {
  it("sums all buckets", () => {
    expect(donutTotal([3, 1, 0, 2])).toBe(6);
    expect(donutTotal([0, 0, 0, 0])).toBe(0);
  });
});

describe("buildDonutStrokeSegments", () => {
  it("returns one segment per non-zero bucket, proportional to share of total", () => {
    const counts: DonutCounts = [3, 1, 0, 0];
    const radius = 10;
    const circumference = 2 * Math.PI * radius;
    const segments = buildDonutStrokeSegments(counts, COLORS, radius);
    expect(segments).toHaveLength(2);
    expect(defined(segments[0]).index).toBe(0);
    expect(defined(segments[0]).color).toBe(COLORS[0]);
    expect(defined(segments[1]).index).toBe(1);

    // First segment's arc length is 3/4 of the circumference.
    const [firstArc] = defined(segments[0]).dasharray.split(" ").map(Number);
    expect(firstArc).toBeCloseTo(circumference * 0.75, 2);
    // Segments are laid end to end: the second starts where the first ends.
    expect(defined(segments[1]).dashoffset).toBeCloseTo(-defined(firstArc), 2);
    expect(defined(segments[0]).dashoffset).toBeCloseTo(0, 5);
  });

  it("returns no segments when every bucket is empty or radius is non-positive", () => {
    expect(buildDonutStrokeSegments([0, 0, 0, 0], COLORS, 10)).toEqual([]);
    expect(buildDonutStrokeSegments([1, 0, 0, 0], COLORS, 0)).toEqual([]);
  });

  it("omits zero-count buckets entirely (proportional to what actually renders)", () => {
    const segments = buildDonutStrokeSegments([0, 5, 0, 5], COLORS, 10);
    expect(segments.map((s) => s.index)).toEqual([1, 3]);
  });
});

describe("formatDonutCount", () => {
  it("matches supercluster's point_count_abbreviated exactly", () => {
    expect(formatDonutCount(3)).toBe("3");
    expect(formatDonutCount(999)).toBe("999");
    expect(formatDonutCount(1000)).toBe("1k");
    expect(formatDonutCount(1500)).toBe("1.5k");
    expect(formatDonutCount(9999)).toBe("10k");
    expect(formatDonutCount(10000)).toBe("10k");
    expect(formatDonutCount(12345)).toBe("12k");
  });
});

describe("buildDonutMarkerSvg", () => {
  const params = (over: Partial<DonutMarkerSvgParams> = {}): DonutMarkerSvgParams => ({
    counts: [2, 1, 0, 0],
    colors: COLORS,
    discColor: "#fffdf9",
    casingColor: "#0b0b0d",
    trackColor: "#666670",
    textColor: "#111111",
    outerRadius: 22,
    figure: null,
    ...over,
  });
  const widthOf = (svg: string) => Number(/width="([\d.]+)"/.exec(svg)?.[1]);

  it("renders one ring segment per non-zero bucket and the count when there is no price", () => {
    const svg = buildDonutMarkerSvg(params());
    expect(svg).toContain("<svg");
    expect(svg).toContain(">3<"); // the count, where no pub says a price
    expect((svg.match(/data-bucket="0"/g) ?? []).length).toBe(1);
    expect((svg.match(/data-bucket="1"/g) ?? []).length).toBe(1);
    expect(svg).not.toContain('data-bucket="2"');
    expect(svg).not.toContain('data-bucket="3"');
    expect(svg).toContain(COLORS[0]);
    expect(svg).toContain(COLORS[1]);
  });

  it("is a paper disc on an ink casing, with the band as a ring and never a fill", () => {
    const svg = buildDonutMarkerSvg(params());
    const circles = svg.match(/<circle [^>]*>/g) ?? [];
    // casing, paper, track, then one per segment
    expect(circles[0]).toContain('fill="#0b0b0d"');
    expect(circles[1]).toContain('fill="#fffdf9"');
    for (const segment of circles.filter((c) => c.includes("data-bucket"))) {
      expect(segment).toContain('fill="none"');
      expect(segment).toContain('stroke-width="3"');
    }
    // No band colour is ever a fill.
    for (const colour of COLORS) expect(svg).not.toContain(`fill="${colour}"`);
  });

  it("prints the cheapest price in the middle and the count on the rim from ten pubs up", () => {
    const priced = buildDonutMarkerSvg(params({ counts: [60, 20, 14, 0], figure: "£3.20" }));
    expect(priced).toMatch(/data-role="figure">£3\.20</);
    expect(priced).toMatch(/data-role="count">94</);
    // A small cluster's count says less than its size does, so it stays off.
    const small = buildDonutMarkerSvg(params({ counts: [2, 1, 0, 0], figure: "£3.20" }));
    expect(DONUT_BADGE_MIN).toBe(10);
    expect(small).not.toContain('data-role="count"');
    // And with no price the count IS the figure, never printed twice.
    const unpriced = buildDonutMarkerSvg(params({ counts: [60, 20, 14, 0], figure: null }));
    expect(unpriced).toMatch(/data-role="figure">94</);
    expect(unpriced).not.toContain('data-role="count"');
  });

  it("fits the widest price inside the paper within the ring, at both disc sizes", () => {
    // The figure is set in JetBrains Mono, whose every glyph advances 600/1000
    // of an em, so a label's width is its length times 0.6 times its size.
    // Measured live, a fixed 11px "£5.50" was 33px across 27.5px of paper.
    const ADVANCE_EM = 0.6;
    const figureWidth = (svg: string, label: string) => {
      const size = Number(/font-size="([\d.]+)"[^>]*data-role="figure"/.exec(svg)?.[1]);
      return label.length * ADVANCE_EM * size;
    };
    for (const outerRadius of [22, 18]) {
      const paper = 2 * (outerRadius - DONUT_CASING_PX - DONUT_RING_PX);
      for (const label of ["£12.50", "£5.50", "1.5k", "94"]) {
        const svg = buildDonutMarkerSvg(params({ outerRadius, figure: label }));
        expect(figureWidth(svg, label)).toBeLessThan(paper);
      }
    }
    // A short figure keeps the full size: only a long one steps down.
    const count = buildDonutMarkerSvg(params({ outerRadius: 22, counts: [60, 20, 14, 0] }));
    expect(count).toMatch(/font-size="12"[^>]*data-role="figure">94</);
  });

  it("is the size the radius says, 44px and 36px", () => {
    expect(widthOf(buildDonutMarkerSvg(params({ outerRadius: 22 })))).toBe(44);
    expect(widthOf(buildDonutMarkerSvg(params({ outerRadius: 18 })))).toBe(36);
  });
});
