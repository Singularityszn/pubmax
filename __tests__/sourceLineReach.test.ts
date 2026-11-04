// A SOURCE LINE IS ONE SENTENCE, AND ITS LINK REACHES PAST THE LINE.
//
// "Listed by Pint Prices, collected 2 October 2026." names who published a
// price and the day it was read. Its link needs the house 44px tap area, and
// the tap audit measures the link's own box (e2e/ui-ux-battle-test.spec.ts),
// so the box stays 44px. A 44px box on the baseline made its whole line 44px
// tall: on a phone the wrapped "2026." sat a full line below the rest of the
// sentence, on the home page, the pub page and the ledger (design plan step
// 0.2). The fix is the pattern the landing hunt card already used: negative
// block margins give the line back what the box adds, and the box is centred
// on the line. On the ledger the published lane also wore the black map
// button inside the sentence. These pins hold every source-line link to it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

/** Every declaration the file gives a selector, across every rule that lists it. */
function declarationsFor(css: string, selector: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((part) => part.trim());
    if (!selectors.includes(selector)) continue;
    for (const declaration of (match[2] ?? "").split(";")) {
      const at = declaration.indexOf(":");
      if (at === -1) continue;
      declarations.set(declaration.slice(0, at).trim(), declaration.slice(at + 1).trim());
    }
  }
  return declarations;
}

const SOURCE_LINE_LINKS: ReadonlyArray<{ file: string; selector: string; where: string }> = [
  { file: "components/venue/ListedPriceSource.module.css", selector: ".publisher", where: "pub page, ledger, invite" },
  { file: "components/landing/landing.css", selector: ".lpPubSource a", where: "home answer card" },
  { file: "components/landing/landing.css", selector: ".lpPubThenSource a", where: "home earlier price" },
  { file: "components/landing/landing.css", selector: ".lpPhotoCredit a", where: "home photo credit" },
  { file: "components/landing/landing.css", selector: ".landingPhotoCredit a", where: "home photo credit" },
  { file: "components/landing/landing.css", selector: ".lpHuntSource a", where: "home hunt card" },
  { file: "components/landing/landing.css", selector: ".lpHuntCitySource a", where: "home city list" },
  { file: "app/ledger/[id]/ledger.css", selector: ".ledgerSourceLink", where: "ledger published price" },
];

describe("a source line's link keeps 44px and does not grow its line", () => {
  for (const { file, selector, where } of SOURCE_LINE_LINKS) {
    it(`${selector} (${where})`, () => {
      const declarations = declarationsFor(read(file), selector);
      expect(declarations.get("min-height"), `${file} ${selector}`).toBe("44px");
      expect(declarations.get("min-width"), `${file} ${selector}`).toBe("44px");
      expect(declarations.get("margin-block"), `${file} ${selector}`).toBe("calc(-1 * var(--space-3))");
      expect(declarations.get("vertical-align"), `${file} ${selector}`).toBe("middle");
    });
  }

  it("never dresses the ledger's publisher as the map button", () => {
    const ledger = read("components/ledger/LedgerLive.tsx");
    const sentence = ledger.slice(ledger.indexOf("Listed by {sourceUrl"));
    expect(sentence.slice(0, 200)).toContain('className="ledgerSourceLink"');
    expect(sentence.slice(0, 200)).not.toContain("ledgerMapLink");
  });
});
