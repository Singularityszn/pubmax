// The shared blocking-load indicator: decorative glass, optional label line,
// per-instance SVG ids, and a stylesheet whose motion only runs for readers
// who have not asked the system to reduce it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type AtRule, type Declaration } from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PintLoader from "@/components/ui/pint-loader";

type ParsedDeclaration = { property: string; value: string; media: string[] };

function parseDeclarations(): ParsedDeclaration[] {
  const root = postcss.parse(
    readFileSync(join(process.cwd(), "components/ui/pintLoader.css"), "utf8"),
  );
  const declarations: ParsedDeclaration[] = [];
  root.walkDecls((decl: Declaration) => {
    const media: string[] = [];
    for (let node = decl.parent; node && node.type !== "root"; node = node.parent) {
      if (node.type !== "atrule") continue;
      const atRule = node as AtRule;
      if (atRule.name === "keyframes") return;
      if (atRule.name === "media") media.push(atRule.params.replace(/\s+/g, " ").trim());
    }
    declarations.push({ property: decl.prop.toLowerCase(), value: decl.value.trim(), media });
  });
  return declarations;
}

const PAINT_PROPERTIES = new Set(["color", "fill", "stroke", "stop-color", "background", "background-color"]);
const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(?:white|black)\b/i;

function idsIn(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? "");
}

function urlRefsIn(html: string): string[] {
  return [...html.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1] ?? "");
}

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

  it("gives every instance its own gradient and clip ids, and points each glass at its own", () => {
    const html = renderToStaticMarkup(
      <>
        <PintLoader />
        <PintLoader size="sm" />
      </>,
    );
    const ids = idsIn(html);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);

    const glasses = html.split("<svg").slice(1);
    expect(glasses).toHaveLength(2);
    for (const glass of glasses) {
      const own = idsIn(glass);
      const refs = urlRefsIn(glass);
      expect(refs).toHaveLength(2);
      for (const ref of refs) expect(own).toContain(ref);
    }
  });

  it("prints the quiet label line only when asked", () => {
    expect(renderToStaticMarkup(<PintLoader label="Tonight" labelSize="quiet" />)).toContain(
      "pintLoader--quietLabel",
    );
    expect(renderToStaticMarkup(<PintLoader label="Tonight" />)).not.toContain(
      "pintLoader--quietLabel",
    );
  });

  it("animates only under prefers-reduced-motion: no-preference", () => {
    const animated = parseDeclarations().filter(
      (decl) =>
        (decl.property === "animation" || decl.property === "animation-name") && decl.value !== "none",
    );
    expect(animated.length).toBeGreaterThan(0);
    for (const decl of animated) {
      expect(decl.media).toContain("(prefers-reduced-motion: no-preference)");
    }
  });

  it("paints every colour from a design token", () => {
    const paints = parseDeclarations().filter(
      (decl) => PAINT_PROPERTIES.has(decl.property) && decl.value !== "none",
    );
    expect(paints.length).toBeGreaterThan(0);
    for (const decl of paints) {
      expect(decl.value, `${decl.property}: ${decl.value}`).toMatch(/var\(--/);
      expect(decl.value, `${decl.property}: ${decl.value}`).not.toMatch(RAW_COLOUR);
    }
  });
});
