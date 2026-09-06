// The compose control must not stand on the content, and it must not exist on
// a page that has nothing to compose.
//
// DEFECT (UI audit, 2026-09-01, production, 390x844): at rest, the pink +
// covered the right of the founders wall's last row and cut the title and
// external-link icon off /today's third Tonight card. Nothing was wrong with
// either page: the body reserved the TAB BAR's lane and nothing else, while
// the control floats one gap above that lane and is 56px tall, so the last 68
// pixels of every scrollable page were under it with no way to scroll clear.
//
// Same audit: the control offers three unrelated compositions on the Pub Pal
// intro, which is one coral call to action, and on the 404.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { shouldShowMobileTabBar } from "@/components/nav/MobileTabBar";
import { createFabVisible } from "@/components/nav/createFabActions";

const REPO_ROOT = join(__dirname, "..");

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), "utf8");
}

const mobileNavCss = read("components/nav/mobileNav.css");
const createFabCss = read("components/nav/createFab.css");
const nearMeNowCss = read("components/nearme/nearMeNow.css");

describe("the body reserves the control's own lane", () => {
  it("publishes the create action's geometry beside every other member", () => {
    expect(mobileNavCss).toContain("--create-fab-h: 56px;");
    expect(mobileNavCss).toContain("--create-fab-bottom: var(--float-stack-base);");
    expect(mobileNavCss).toContain(
      "--float-stack-top-create: calc(var(--create-fab-bottom) + var(--create-fab-h));",
    );
  });

  it("reserves that top edge rather than the tab bar alone", () => {
    const rule = mobileNavCss.slice(
      mobileNavCss.indexOf("body:has(.createFabRoot)"),
    );
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("padding-bottom: var(--float-stack-top-create);");
    // A number restated here is how the stack broke three times already.
    expect(body).not.toMatch(/\d+px/);
  });

  it("keeps the reserved lane strictly above the bar's own clearance", () => {
    // --float-stack-top-create is --float-stack-base + 56px, and the base is
    // itself the bar plus a gap, so the reserved lane can only be the larger.
    expect(mobileNavCss).toContain(
      "--float-stack-base: calc(\n    var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + var(--float-stack-gap)\n  );",
    );
  });

  it("gives a page that hides the control the bar's clearance and no more", () => {
    expect(mobileNavCss).toContain(
      "body:has(.createFabRoot):not(:has(.pageHidesCreateFab))",
    );
  });
});

// GAP 19 (mobile store-readiness audit, 2026-09-04, 390x844): the control also
// owns a HORIZONTAL lane, and on /near it stood on the right-hand price of the
// row under it. The price is the product, so the list reserves that lane the
// way the map chrome reserves --mobile-map-corner-lane. Rendered proof at 320,
// 390 and 430 is e2e/mobile-map-chrome-fit.spec.ts.
describe("the list reserves the control's horizontal lane", () => {
  it("publishes the control's own right inset and lane beside its berth", () => {
    expect(mobileNavCss).toContain(
      "--create-fab-right: calc(12px + env(safe-area-inset-right, 0px));",
    );
    expect(mobileNavCss).toContain(
      "--create-fab-lane: calc(\n    var(--create-fab-right) + var(--create-fab-h) + var(--float-stack-gap)\n  );",
    );
  });

  it("makes the control read that published inset rather than restate it", () => {
    expect(createFabCss).toContain("right: var(--create-fab-right);");
    expect(createFabCss).not.toContain("right: calc(12px + env(safe-area-inset-right, 0px));");
  });

  it("reserves the lane on the price column, derived and never restated", () => {
    const start = nearMeNowCss.indexOf("padding-right: max(");
    expect(start, "the price column reserves a lane").toBeGreaterThan(-1);
    const rule = nearMeNowCss.slice(start, nearMeNowCss.indexOf(";", start));
    expect(rule).toContain("var(--create-fab-lane)");
    expect(rule).toContain("var(--page-gutter)");
    // A number written here is how the float stack broke three times already.
    expect(rule).not.toMatch(/\d+px/);
  });

  it("gives the caption and the collected line the same lane, so the column moves as one", () => {
    expect(nearMeNowCss).toContain(
      ":is(.nmnListCaption, .nmnCard, .nmnPriceCollected)",
    );
  });

  it("keeps the reservation to the phone, where the control is", () => {
    const block = nearMeNowCss.slice(nearMeNowCss.indexOf(".nmnPriceCollected {"));
    const media = block.slice(block.indexOf("@media"));
    expect(media.startsWith("@media (max-width: 640px)")).toBe(true);
  });
});

describe("the pages with nothing to compose", () => {
  it("hides the control on the Pub Pal intro and nowhere near it", () => {
    expect(createFabVisible("/pal")).toBe(false);
    expect(createFabVisible("/pal/chat")).toBe(true);
    expect(createFabVisible("/")).toBe(true);
    expect(createFabVisible("/founders")).toBe(true);
    expect(createFabVisible("/today")).toBe(true);
  });

  it("leaves the tab-bar chrome on every route, which is a separate law", () => {
    for (const path of ["/", "/pal", "/pal/chat", "/founders", "/today"]) {
      expect(shouldShowMobileTabBar(path), path).toBe(true);
    }
  });

  it("hides it on a plan, whose whole ask is the link it stands over", () => {
    // The three rows are a Moment, a price and "Start a plan": none of them a
    // locked plan's business, and the last is a door back to the page the
    // reader has just finished making. It sat over `Copy invite link` at 390
    // (PlanAstra 23). Marker rather than a path, because `createFabVisible`
    // matches a pathname exactly and every plan carries an id of its own.
    for (const file of ["app/plan/[id]/page.tsx", "app/plan/[id]/not-found.tsx"]) {
      expect(read(file), file).toContain("pageHidesCreateFab");
    }
  });

  it("hides it on the 404 by marker, because that page has no path", () => {
    expect(read("app/not-found.tsx")).toContain('className="pageHidesCreateFab"');
    const rule = createFabCss.slice(
      createFabCss.indexOf("body:has(.pageHidesCreateFab) .createFabRoot"),
    );
    expect(rule.slice(0, rule.indexOf("}"))).toContain("display: none;");
  });
});
