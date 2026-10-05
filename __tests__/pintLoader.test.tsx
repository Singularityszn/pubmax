// The shared blocking-load indicator: decorative glass, optional quiet label,
// and a reduced-motion fallback that stops every moving part.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PintLoader from "@/components/ui/pint-loader";

const css = readFileSync(join(process.cwd(), "components/ui/pintLoader.css"), "utf8");

describe("PintLoader", () => {
  it("hides the glass from assistive tech and announces nothing itself", () => {
    const html = renderToStaticMarkup(<PintLoader label="Out" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
    expect(html).not.toContain("aria-live");
    expect(html).toContain(">Out<");
  });

  it("renders no label line when none is given", () => {
    expect(renderToStaticMarkup(<PintLoader />)).not.toContain("pintLoaderLabel");
  });

  it("only animates behind prefers-reduced-motion: no-preference", () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/, "");
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(outside).not.toMatch(/animation\s*:/);
    expect(outside).not.toMatch(/animation-name\s*:/);
  });

  it("paints from tokens, not raw brand hexes", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
