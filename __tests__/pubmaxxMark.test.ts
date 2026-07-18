import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PubmaxxMark, { MARK_GEOMETRY } from "@/components/brand/PubmaxxMark";

function render(props: Parameters<typeof PubmaxxMark>[0] = {}): string {
  return renderToStaticMarkup(createElement(PubmaxxMark, props));
}

describe("PubmaxxMark", () => {
  it("renders a valid single-X SVG with the shared geometry", () => {
    const svg = render();
    expect(svg).toContain("<svg");
    expect(svg).toContain(`viewBox="${MARK_GEOMETRY.viewBox}"`);
    // Two crossing arms.
    expect(svg).toContain(`M${MARK_GEOMETRY.armA.x1} ${MARK_GEOMETRY.armA.y1}`);
    expect(svg).toContain(`M${MARK_GEOMETRY.armB.x1} ${MARK_GEOMETRY.armB.y1}`);
    expect((svg.match(/<path/g) ?? []).length).toBe(2);
  });

  it("mono variant is theme-agnostic: uses currentColor, no baked hex", () => {
    const svg = render({ variant: "mono" });
    expect(svg).toContain("currentColor");
    expect(svg).not.toMatch(/#[0-9a-f]{6}/i);
    // No lit node in the bare mono mark.
    expect(svg).not.toContain("<circle");
  });

  it("renders correctly in both themes via token custom properties", () => {
    // The mark never hardcodes a single theme's colour — brand variants pull
    // live tokens (which flip between light/dark) with a literal fallback, so
    // one render is correct under html[data-theme=light] and =dark alike.
    const duo = render({ variant: "duo" });
    expect(duo).toContain("var(--brass, #ff5a5f)");
    expect(duo).toContain("var(--amber, #f0a01a)");
    expect(duo).toContain("var(--brass-bright, #ff7a55)");

    const plaque = render({ variant: "plaque" });
    expect(plaque).toContain("<rect");
    expect(plaque).toContain("var(--brass, #ff5a5f)"); // chip
    expect(plaque).toContain("var(--ink-deep, #060607)"); // knocked-out X
    expect(plaque).toContain(`rx="${MARK_GEOMETRY.plaqueRadius}"`);
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
