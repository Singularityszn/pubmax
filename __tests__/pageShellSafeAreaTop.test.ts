import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

// THE TOP SAFE AREA IS PAID ONCE, AND THE BAR PAYS IT.
//
// components/nav/siteNav.css gives the standard bar
// `margin-top: env(safe-area-inset-top)`, so on a notched phone the bar clears
// the clock by itself. A page shell that mounts SiteNav as its first child and
// ALSO adds the inset to its own top padding pays it twice: /out and /today
// did, and in the iOS shell the bar sat 59px lower than on /tonight with a
// blank band above it (docs/proof/mobile-app-design/ios-sim-iphone17pro/out/).
// An ordinary browser answers 0 for env(), which is why nobody saw it on the
// web and why this is a fence rather than a screenshot.
//
// The list is the page shells whose FIRST CHILD is the standard SiteNav. A
// page that floats its bar or draws no bar keeps its own inset and is not
// listed here.
const ROOT = join(__dirname, "..");

const PAGE_SHELLS_UNDER_THE_STANDARD_BAR: ReadonlyArray<{
  stylesheet: string;
  shellClass: string;
  mounts: string;
}> = [
  { stylesheet: "app/out/out.css", shellClass: "outPage", mounts: "app/out/OutClient.tsx" },
  { stylesheet: "app/today/today.css", shellClass: "todayPage", mounts: "app/today/TodayClient.tsx" },
  { stylesheet: "app/tonight/tonight.css", shellClass: "tonightPage", mounts: "app/tonight/TonightClient.tsx" },
  { stylesheet: "app/plan/plan.css", shellClass: "planPage", mounts: "app/plan/page.tsx" },
];

/** Every rule block for the shell class, media overrides included. */
function shellBlocks(stylesheet: string, shellClass: string): string[] {
  // Comments first: a brace inside one would end a block early.
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...css.matchAll(new RegExp(`\\.${shellClass}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => defined(match[1]),
  );
  expect(blocks.length, `${shellClass} blocks`).toBeGreaterThan(0);
  return blocks;
}

describe("a page shell under the standard bar does not add the top inset the bar already adds", () => {
  it("is measuring the bar that really carries the inset", () => {
    const nav = readFileSync(join(ROOT, "components/nav/siteNav.css"), "utf8");
    expect(nav).toContain("margin-top: env(safe-area-inset-top, 0px);");
  });

  for (const page of PAGE_SHELLS_UNDER_THE_STANDARD_BAR) {
    it(`${page.shellClass} mounts SiteNav first and pays the inset once`, () => {
      const tsx = readFileSync(join(ROOT, page.mounts), "utf8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      expect(tsx).toMatch(new RegExp(`className="${page.shellClass}[^"]*"[^>]*>\\s*<SiteNav`));
      const blocks = shellBlocks(readFileSync(join(ROOT, page.stylesheet), "utf8"), page.shellClass);
      const paddingTop = blocks.flatMap((block) => block.match(/padding(?:-top)?:\s*([^;]+);/g) ?? []);
      expect(paddingTop.length).toBeGreaterThan(0);
      for (const declaration of paddingTop) {
        expect(declaration).not.toContain("safe-area-inset-top");
      }
    });
  }
});
