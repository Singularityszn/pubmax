import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PubmaxxMark, { MARK_GEOMETRY } from "@/components/brand/PubmaxxMark";

function render(props: Parameters<typeof PubmaxxMark>[0] = {}): string {
  return renderToStaticMarkup(createElement(PubmaxxMark, props));
}

describe("PubmaxxMark — The Clink", () => {
  it("pins the canonical Clink geometry (two tapered pint arms + ember node)", () => {
    // These coordinates are the master brand geometry, owner-approved
    // 2026-07-21. They must stay in lockstep with scripts/gen-brand-assets.mjs
    // and scripts/gen-native-app-icons.mjs — a drift here ships everywhere.
    expect(MARK_GEOMETRY.viewBox).toBe("0 0 64 64");
    expect(MARK_GEOMETRY.armA).toBe("19.8,8.7 10.2,17.3 46.0,53.7 52.0,48.3");
    expect(MARK_GEOMETRY.armB).toBe("44.2,8.7 53.8,17.3 18.0,53.7 12.0,48.3");
    expect(MARK_GEOMETRY.node).toEqual({ cx: 32, cy: 32, r: 3.2 });
    expect(MARK_GEOMETRY.plaqueRadius).toBe(15);
  });

  it("renders the arms as two filled polygons — never stroked paths", () => {
    const svg = render();
    expect(svg).toContain("<svg");
    expect(svg).toContain(`viewBox="${MARK_GEOMETRY.viewBox}"`);
    expect(svg).toContain(`points="${MARK_GEOMETRY.armA}"`);
    expect(svg).toContain(`points="${MARK_GEOMETRY.armB}"`);
    expect((svg.match(/<polygon/g) ?? []).length).toBe(2);
    // The Clink is filled geometry: no <path>, no stroke language survives.
    expect(svg).not.toContain("<path");
    expect(svg).not.toContain("stroke-width");
  });

  it("mono variant is theme-agnostic: currentColor arms, no baked hex, no node", () => {
    const svg = render({ variant: "mono" });
    expect(svg).toContain("currentColor");
    expect(svg).not.toMatch(/#[0-9a-f]{6}/i);
    // No lit ember and no tile in the bare mono mark.
    expect(svg).not.toContain("<circle");
    expect(svg).not.toContain("<rect");
  });

  it("duo variant is the bare coral Clink with a lit ember, on transparent", () => {
    const duo = render({ variant: "duo" });
    // Both arms are coral (no amber anywhere in the Clink palette).
    expect((duo.match(/var\(--brass, #ff5a5f\)/g) ?? []).length).toBe(2);
    expect(duo).not.toContain("--amber");
    expect(duo).toContain("var(--brass-bright, #ff7a55)"); // ember
    expect(duo).toContain("<circle");
    expect(duo).not.toContain("<rect"); // transparent, no tile
  });

  it("plaque variant lays the coral Clink + ember on an ink-deep tile", () => {
    const plaque = render({ variant: "plaque" });
    expect(plaque).toContain("<rect");
    expect(plaque).toContain(`rx="${MARK_GEOMETRY.plaqueRadius}"`);
    expect(plaque).toContain("var(--ink-deep, #060607)"); // tile
    expect((plaque.match(/var\(--brass, #ff5a5f\)/g) ?? []).length).toBe(2); // coral arms
    expect(plaque).toContain("var(--brass-bright, #ff7a55)"); // ember
  });

  it("renders correctly in both themes via token custom properties", () => {
    // The mark never hardcodes a single theme's colour — brand variants pull
    // live tokens (which flip between light/dark) with a literal fallback, so
    // one render is correct under html[data-theme=light] and =dark alike.
    const duo = render({ variant: "duo" });
    expect(duo).toContain("var(--brass, #ff5a5f)");
    expect(duo).toContain("var(--brass-bright, #ff7a55)");
  });

  it("honours the size prop (favicon → hero)", () => {
    expect(render({ size: 16 })).toContain('width="16"');
    expect(render({ size: 512 })).toContain('width="512"');
  });

  it("is decorative by default and labelled when given a title", () => {
    expect(render()).toContain('aria-hidden="true"');
    const labelled = render({ title: "PUBMAXX" });
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain("<title>PUBMAXX</title>");
    expect(labelled).not.toContain('aria-hidden="true"');
  });
});
