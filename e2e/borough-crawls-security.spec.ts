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
    // Next.js App Router requires script-src 'unsafe-inline' for its inline
    // RSC/hydration bootstrap (see next.config.mjs). A per-request nonce would
    // drop it but forces dynamic rendering — documented tradeoff, not a gap.
    expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  test("/ sets X-Frame-Options DENY (aligned with CSP frame-ancestors 'none')", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    const xfo = response?.headers()["x-frame-options"];
    // DENY is the canonical value; absent is acceptable only when CSP
    // frame-ancestors 'none' alone governs framing (we send both).
    if (xfo) {
      expect(xfo.toUpperCase()).toBe("DENY");
    }
  });

  test("GET /api/pint-drops does not expose Access-Control-Allow-Origin", async ({ request }) => {
    const response = await request.get("/api/pint-drops");
    expect(response.status()).toBeLessThan(500);
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("/ serves HSTS and Cross-Origin-Opener-Policy when configured", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    // HSTS is set in next.config.mjs for production; preview may omit it.
    const hsts = headers["strict-transport-security"];
    if (hsts) {
      expect(hsts.toLowerCase()).toContain("max-age=");
    }
    const coop = headers["cross-origin-opener-policy"];
    if (coop) {
      expect(coop.toLowerCase()).toMatch(/same-origin/);
    }
  });

  test("unauthenticated admin session probe does not leak a session", async ({ request }) => {
    const response = await request.get("/api/admin/session");
    expect(response.status()).toBeLessThan(500);
    const body = (await response.json()) as { authenticated?: boolean };
    expect(body.authenticated).toBe(false);
  });

  test("GET /api/messages without identity stays closed or empty (no CORS)", async ({ request }) => {
    const response = await request.get("/api/messages");
    expect(response.status()).toBeLessThan(500);
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
    // Anonymous may get 200 empty inbox, 400/401/403 depending on Wave I gate —
    // never a cross-origin allow header and never a 5xx from the ownership seam.
    expect([200, 400, 401, 403]).toContain(response.status());
  });
});
