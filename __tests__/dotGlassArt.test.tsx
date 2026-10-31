import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ErrorPage from "@/app/error";
import NotFound from "@/app/not-found";
import { EmptyGlassArt, SpilledGlassArt, emptyGlass, spilledGlass } from "@/components/brand/DotGlassArt";
import { glassCapacity, glassPoints } from "@/lib/dotGlass";

// The empty and spilled pints on the 404 and error pages
// (components/brand/DotGlassArt.tsx), drawn from the shared pint outline
// (lib/dotGlass.ts).

describe("the pint outline", () => {
  it("returns as many points as it seats, bottom row first", () => {
    const points = glassPoints(72, 112, 8);
    expect(points).toHaveLength(glassCapacity(72, 112, 8));
    expect(points[0]!.y).toBeGreaterThan(points[points.length - 1]!.y);
  });

  it("stops at a count, and keeps a part-filled top row centred", () => {
    const points = glassPoints(72, 112, 8, 10);
    expect(points).toHaveLength(10);
    const top = points.filter((p) => p.y === points[9]!.y);
    const mean = top.reduce((sum, p) => sum + p.x, 0) / top.length;
    expect(mean).toBeCloseTo(36, 5);
  });
});

describe("the empty glass", () => {
  it("lights only the bottom row, the dregs", () => {
    const { dim, lit } = emptyGlass();
    expect(lit.length).toBeGreaterThan(0);
    expect(new Set(lit.map((p) => p.y)).size).toBe(1);
    expect(Math.max(...dim.map((p) => p.y))).toBeLessThan(lit[0]!.y);
  });
});

describe("the spilled glass", () => {
  it("rests on the floor and stays inside the picture", () => {
    const { dim, lit } = spilledGlass();
    const all = [...dim, ...lit];
    expect(Math.min(...all.map((p) => p.x))).toBeGreaterThan(0);
    expect(Math.max(...all.map((p) => p.x))).toBeLessThan(200);
    expect(Math.min(...all.map((p) => p.y))).toBeGreaterThan(0);
    expect(Math.max(...all.map((p) => p.y))).toBe(72);
  });

  it("spills past the rim", () => {
    const { dim, lit } = spilledGlass();
    const rim = Math.max(...dim.map((p) => p.x));
    expect(lit.filter((p) => p.x > rim).length).toBeGreaterThanOrEqual(10);
  });
});

describe("the pictures", () => {
  it("are hidden from assistive tech and draw no words", () => {
    for (const art of [<EmptyGlassArt key="e" />, <SpilledGlassArt key="s" />]) {
      const html = renderToStaticMarkup(art);
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/<text/);
    }
  });

  it("paint with tokens and never coral, or leave the hue to a stylesheet", () => {
    const tokens = renderToStaticMarkup(<SpilledGlassArt />);
    expect(tokens).toContain("var(--amber)");
    expect(tokens).not.toMatch(/--brass|--night-amber|--color-accent|#ff5a5f/i);
    const bare = renderToStaticMarkup(<SpilledGlassArt fills={null} />);
    expect(bare).not.toContain("fill:");
    expect(bare).toContain('class="dotArtLit"');
  });

  it("stand on the 404 and the error page", () => {
    expect(renderToStaticMarkup(<NotFound />)).toContain('class="dotArtDim"');
    expect(renderToStaticMarkup(<ErrorPage error={new Error("x")} retry={() => {}} />)).toContain('class="dotArtLit"');
  });
});
