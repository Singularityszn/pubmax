import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The ledger, invite and permalink pages paint their primary link as
// `--panel-raised` text on an `--ink-deep` fill. Both tokens flip in dark, so
// the link came out as rgb(32,32,36) on rgb(6,6,7), about 1.2:1 and invisible
// (QA journeys report F02). Each sheet must give the dark theme the house
// primary: the accent fill with the on-accent ink.

const PRIMARIES = [
  { file: "app/ledger/[id]/ledger.css", selectors: [".ledgerMapLink", ".ledgerPrimaryLink"] },
  { file: "app/invite/[token]/invite.css", selectors: [".invite__primary"] },
  { file: "app/p/[id]/permalink.css", selectors: [".permalink__primary"] },
];

function darkRule(css: string, selector: string, pseudo = ""): string {
  const head = `html[data-theme="dark"] ${selector}${pseudo}`;
  const escaped = head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("a primary link stays readable in the dark theme", () => {
  for (const { file, selectors } of PRIMARIES) {
    const css = readFileSync(join(process.cwd(), file), "utf8");
    for (const selector of selectors) {
      it(`${file} ${selector} wears the accent fill and on-accent ink`, () => {
        const rest = darkRule(css, selector);
        expect(rest).toContain("background: var(--color-accent)");
        expect(rest).toContain("color: var(--color-on-accent)");
        const hover = darkRule(css, selector, ":hover");
        expect(hover).toContain("background: var(--color-accent-strong)");
        expect(hover).toContain("color: var(--color-on-accent-strong)");
      });
    }
  }
});
