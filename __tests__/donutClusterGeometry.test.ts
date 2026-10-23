import { describe, expect, it } from "vitest";

import {
  buildDonutMarkerSvg,
  DONUT_CASING_PX,
  DONUT_RING_PX,
  donutOuterRadius,
  donutTotal,
  formatDonutCount,
  readMinPrice,
  type DonutMarkerSvgParams,
} from "@/lib/donutClusterGeometry";

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
    discColor: "#fffdf9",
    casingColor: "#0b0b0d",
    trackColor: "#666670",
    textColor: "#111111",
    figureColor: COLORS[0]!,
    outerRadius: 22,
    figure: null,
    ...over,
  });
  const widthOf = (svg: string) => Number(/width="([\d.]+)"/.exec(svg)?.[1]);

  it("prints the count in ink when there is no price, on a ring that carries no band", () => {
    const svg = buildDonutMarkerSvg(params());
    expect(svg).toContain("<svg");
    expect(svg).toMatch(/fill="#111111"[^>]*data-role="figure">3</);
    expect(svg).not.toContain("data-bucket");
    for (const colour of COLORS) expect(svg).not.toContain(colour);
  });

  it("is a paper disc on an ink casing with a neutral ring, and no band is ever a fill", () => {
    const svg = buildDonutMarkerSvg(params({ figure: "£3.20" }));
    const circles = svg.match(/<circle [^>]*>/g) ?? [];
    // casing, paper, the neutral ring, and nothing else
    expect(circles).toHaveLength(3);
    expect(circles[0]).toContain('fill="#0b0b0d"');
    expect(circles[1]).toContain('fill="#fffdf9"');
    expect(circles[2]).toContain('fill="none"');
    expect(circles[2]).toContain('stroke="#666670"');
    expect(circles[2]).toContain('stroke-width="3"');
    for (const colour of COLORS) expect(svg).not.toContain(`fill="${colour}"><`);
  });

  it("prints from and the cheapest price in its band ink, and n pubs under the disc", () => {
    const priced = buildDonutMarkerSvg(params({ counts: [60, 20, 14, 0], figure: "£3.20" }));
    expect(priced).toMatch(new RegExp(`fill="${COLORS[0]}"[^>]*data-role="figure">£3\\.20<`));
    expect(priced).toMatch(/data-role="from">from</);
    expect(priced).toMatch(/data-role="count">94 pubs</);
    // A small cluster says its count too: the label is "from £x · n pubs".
    const small = buildDonutMarkerSvg(params({ counts: [2, 1, 0, 0], figure: "£3.20" }));
    expect(small).toMatch(/data-role="count">3 pubs</);
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
