import { test, expect, type Page } from "@playwright/test";

// Borough pages, the curated-crawls index, and the CSP security header. Borough
// read-surfaces and the crawl permalink/unknown-slug paths already have solid
// coverage in e2e/social-loop.spec.ts (§14/§25/§8) — this file covers what that
// suite doesn't: a real borough page rendering its ranked table end-to-end, the
// crawls page's CURATED cards grid (a static, always-populated list, distinct
// from the per-crawl poster the social-loop suite already exercises), and the
// CSP response header (security: CSP + governance work this session).
//
// Style matches the other new specs: watchPageErrors, web-first assertions, no
// waitForTimeout, .count()-guarded branches for populated-vs-empty states.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.describe("borough page", () => {
  test("a real borough page (westminster) renders its ranked pub table", async ({ page }) => {
    const errors = watchPageErrors(page);

    // "westminster" is the same stable, populated slug e2e/social-loop.spec.ts
    // uses — it resolves to dozens of pubs in the bundled dataset.
    const response = await page.goto("/borough/westminster");
    expect(response?.status()).toBe(200);

    await expect(page.locator("h1.boroughTitle")).toContainText("Pubs in");

    const pubs = page.locator(".boroughTable .boroughPub");
    const empty = page.locator(".boroughEmpty");
    await expect
      .poll(async () => (await pubs.count()) + (await empty.count()))
      .toBeGreaterThan(0);

    if ((await pubs.count()) > 0) {
      // Real ranked rows, each linking onto the map with the pub selected.
      await expect(pubs.first()).toHaveAttribute("href", /^\/map\?sel=/);
    } else {
      await expect(empty).toBeVisible();
    }

    expect(errors).toEqual([]);
  });
});

test.describe("crawls page — curated cards", () => {
  test("the crawls index renders the curated crawls grid (static, always-populated)", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/crawls");
    expect(response?.status()).toBe(200);

    // The curated grid is a static, bundled list (lib/curatedCrawls.ts) — unlike
    // the per-crawl poster (?s=), it never depends on the DB, so it should always
    // render at least one card.
    const grid = page.locator(".curatedGrid");
    await expect(grid).toBeVisible();
    const cards = grid.locator(".curatedCard");
    await expect(cards.first()).toBeVisible();
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Each card carries a name, a blurb, and a working link onto the map.
    const first = cards.first();
    await expect(first.locator(".curatedName")).toBeVisible();
    await expect(first.locator(".curatedBlurb")).toBeVisible();
    await expect(first.locator(".curatedLink")).toHaveAttribute("href", /\/map/);

    expect(errors).toEqual([]);
  });
});

test.describe("security headers", () => {
  test("/ serves a Content-Security-Policy header", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    const csp = response?.headers()["content-security-policy"];
    expect(csp).toBeTruthy();
    // Sanity-check a couple of the load-bearing directives from
    // next.config.mjs rather than pinning the whole string (which would make
    // this test brittle to any future directive tweak).
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
  });
});
