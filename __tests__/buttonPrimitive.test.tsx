import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

// A TEXT BUTTON IS ONE ROW OF TOKENS, and the primitive has to be painted where
// that row can reach it. verify-preview-4 (5 Sep 2026) measured the landmark
// story's "Start a crawl here" and "Ask the PUBMAXXER" at 16px and weight 400
// beside a venue sheet whose text buttons wear 13.76px at 700. The primitive
// carried Tailwind's `text-sm font-bold`, which live inside `@layer utilities`,
// while app/globals.css declares `button { font: inherit }` UNLAYERED. An
// unlayered declaration outranks every layered one whatever its order, so the
// primitive lost its type on every surface. Its look now lives in
// components/ui/button.css, outside any layer, reading the --control-* tokens.

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const buttonCss = read("components/ui/button.css");
const globalCss = read("app/globals.css");

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
}

describe("the Button primitive", () => {
  it("is painted OUTSIDE every cascade layer, where the unlayered reset cannot beat it", () => {
    expect(buttonCss).not.toMatch(/^\s*@layer/m);
    // The reason this matters is still true: the reset is unlayered and the
    // utilities are layered. If either changes, revisit whether button.css
    // still has to be a plain sheet.
    expect(globalCss).toMatch(/\nbutton,\s*\ninput,\s*\ntextarea,\s*\nselect\s*{\s*font:\s*inherit;/);
    expect(globalCss).toMatch(/@import "tailwindcss\/utilities\.css" layer\(utilities\)/);
  });

  it("reads the one row of control tokens rather than restating a figure", () => {
    const base = buttonCss.match(/\.uiButton\s*{([^}]*)}/)?.[1] ?? "";
    expect(base).toMatch(/min-height:\s*var\(--control-height/);
    expect(base).toMatch(/padding:\s*0 var\(--control-pad-x/);
    expect(base).toMatch(/border-radius:\s*var\(--control-radius/);
    expect(base).toMatch(/font-size:\s*var\(--control-font-size/);
    expect(base).toMatch(/font-weight:\s*var\(--control-font-weight/);
    // `font: inherit` FIRST, then the two tokens, so the family follows the
    // surface and the size and weight are this sheet's.
    expect(base.indexOf("font: inherit")).toBeLessThan(base.indexOf("font-size:"));
  });

  it("composes classes from that sheet and nothing from a utility layer", () => {
    expect(renderToStaticMarkup(createElement(Button, null, "Go"))).toBe(
      '<button class="uiButton uiButton--primary">Go</button>',
    );
    expect(
      renderToStaticMarkup(createElement(Button, { variant: "secondary", size: "large" }, "Go")),
    ).toBe('<button class="uiButton uiButton--secondary uiButton--large">Go</button>');
    expect(
      renderToStaticMarkup(createElement(Button, { variant: "ghost", size: "icon" }, "x")),
    ).toBe('<button class="uiButton uiButton--ghost uiButton--icon">x</button>');
    // A circular icon control keeps the pill (owner ruling 2026-07-23).
    expect(renderToStaticMarkup(createElement(IconButton, null, "x"))).toBe(
      '<button class="uiButton uiButton--secondary uiButton--icon shrink-0 uiButton--pill">x</button>',
    );
  });

  it("is never handed a layered utility the unlayered sheet would beat", () => {
    // `justify-start`, `rounded-*`, `border-0` and `bg-*` set properties the
    // primitive now declares unlayered, so on a Button they would silently do
    // nothing. The sheet carries modifiers for the two the product needs.
    const files: string[] = [];
    walk(join(ROOT, "app"), files);
    walk(join(ROOT, "components"), files);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/<(Button|IconButton)\b/.test(source)) continue;
      for (const match of source.matchAll(/<(?:Button|IconButton)\b[^>]*className=\{?"([^"]*)"/g)) {
        const classes = match[1]!.split(/\s+/);
        if (classes.some((c) => /^(justify-|rounded|border-0$|bg-)/.test(c))) {
          offenders.push(`${relative(ROOT, file)}: ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the venue sheet's two Save controls wear the same row", () => {
  const saveToList = read("components/savedpubs/saveToList.css");
  const wanted = read("components/wanted/wanted.css");

  it("Save to a list reads the control tokens instead of an 8px box at 13px/600", () => {
    const rule = saveToList.match(/\.saveToListToggle\s*{([^}]*)}/)?.[1] ?? "";
    expect(rule).toMatch(/border-radius:\s*var\(--control-radius/);
    expect(rule).toMatch(/font-size:\s*var\(--control-font-size/);
    expect(rule).toMatch(/font-weight:\s*var\(--control-font-weight/);
    expect(rule).not.toMatch(/border-radius:\s*8px/);
  });

  it("Save for a night reads the control tokens and is a secondary on the Overview", () => {
    const rule = wanted.match(/\.wantedSaveBtn,\s*\n\.wantedCandidate,\s*\n\.wantedRow__map\s*{([^}]*)}/)?.[1] ?? "";
    expect(rule).toMatch(/border-radius:\s*var\(--control-radius/);
    expect(rule).toMatch(/font-size:\s*var\(--control-font-size/);
    expect(rule).toMatch(/font-weight:\s*var\(--control-font-weight/);
    // One painted control per screen: the Overview's is the price door, so
    // this save wears the secondary surface there.
    const overview = wanted.match(/\.wantedSaveWrap \.wantedSaveBtn\s*{([^}]*)}/)?.[1] ?? "";
    expect(overview).toMatch(/background:\s*var\(--control-secondary-surface/);
  });
});
