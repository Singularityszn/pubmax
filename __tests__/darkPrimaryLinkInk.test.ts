import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type Rule } from "postcss";

import { describe, expect, it } from "vitest";

// The ledger, invite and permalink pages paint their primary as `--panel-raised`
// text on an `--ink-deep` fill. Both tokens flip in dark, so the link came out
// as rgb(32,32,36) on rgb(6,6,7), about 1.2:1 and invisible (QA journeys report
// F02). Each sheet must give the dark theme the house primary: the accent fill
// with the on-accent ink.

const PRIMARIES = [
  { file: "app/ledger/[id]/ledger.css", selector: ".ledgerMapLink", hover: true },
  { file: "app/ledger/[id]/ledger.css", selector: ".ledgerPrimaryLink", hover: true },
  { file: "app/invite/[token]/invite.css", selector: ".invite__primary", hover: true },
  { file: "app/p/[id]/permalink.css", selector: ".permalink__primary", hover: true },
  {
    file: "components/ledger/readLedgerButton.css",
    selector: '.ledgerReadButton[aria-pressed="true"]',
    hover: false,
  },
];

const DARK = 'html[data-theme="dark"]';

type Declarations = Map<string, string>;

/** Each top-level selector mapped to the declarations it ends up with, last write winning. */
function declarationsBySelector(file: string): Map<string, Declarations> {
  const model = new Map<string, Declarations>();
  postcss.parse(readFileSync(join(process.cwd(), file), "utf8")).each((node) => {
    if (node.type !== "rule") return;
    for (const raw of (node as Rule).selectors) {
      const selector = raw.replace(/\s+/g, " ").trim();
      const declarations = model.get(selector) ?? new Map<string, string>();
      (node as Rule).walkDecls((decl) => {
        declarations.set(decl.prop.toLowerCase(), decl.value.trim());
      });
      model.set(selector, declarations);
    }
  });
  return model;
}

describe("a primary stays readable in the dark theme", () => {
  for (const { file, selector, hover } of PRIMARIES) {
    const model = declarationsBySelector(file);

    it(`${file} ${selector} paints ink on ink in light, so dark needs its own pair`, () => {
      const light = model.get(selector);
      expect(light?.get("background")).toBe("var(--ink-deep)");
      expect(light?.get("color")).toBe("var(--panel-raised)");
    });

    it(`${file} ${selector} wears the accent fill and on-accent ink in dark`, () => {
      const dark = model.get(`${DARK} ${selector}`);
      expect(dark?.get("background")).toBe("var(--color-accent)");
      expect(dark?.get("border-color")).toBe("var(--color-accent)");
      expect(dark?.get("color")).toBe("var(--color-on-accent)");
    });

    if (hover) {
      it(`${file} ${selector} hovers to the strong accent pair in dark`, () => {
        const dark = model.get(`${DARK} ${selector}:hover`);
        expect(dark?.get("background")).toBe("var(--color-accent-strong)");
        expect(dark?.get("border-color")).toBe("var(--color-accent-strong)");
        expect(dark?.get("color")).toBe("var(--color-on-accent-strong)");
      });
    }
  }
});
