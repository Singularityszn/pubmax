import { expect, test, type Page } from "@playwright/test";

// Out is Tonight now. Product owner, Oct 2026 UX audit: the primary row went
// from six doors to five (Map, Tonight, Plan, Social, You), and Tonight carries what
// the Out tab listed. /out keeps its address for old links, bookmarks and
// shared `?day=` links by answering a permanent 308 to /tonight at the edge
// (proxy.ts, lib/outRoute.ts), with the query kept.
//
// The listing-level proof this file used to hold against the /out page (every
// sourced row renders, supply honesty, Open plans, pub pairing, the desktop
// grouping and the light/dark frames) is about the listings, not the address,
// and belongs with Tonight's own spec now that Tonight renders them.

const WIDTHS = [320, 390, 430] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

test("/out answers a permanent redirect to /tonight, query kept", async ({ request }) => {
  const plain = await request.get("/out", { maxRedirects: 0 });
  expect(plain.status()).toBe(308);
  expect(new URL(plain.headers().location ?? "", "http://x").pathname).toBe("/tonight");

  const weekend = await request.get("/out?day=weekend", { maxRedirects: 0 });
  expect(weekend.status()).toBe(308);
  const target = new URL(weekend.headers().location ?? "", "http://x");
  expect(target.pathname).toBe("/tonight");
  expect(target.search).toBe("?day=weekend");
});

for (const width of WIDTHS) {
  test.describe(`out folded into tonight @${width}`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("an old /out link lands on Tonight, and no Out door is left", async ({ page }) => {
      await page.goto("/out");
      await expect(page).toHaveURL(/\/tonight$/);
      await expect(page.getByTestId("tonight-screen")).toBeVisible();

      const nav = primaryNav(page);
      await expect(nav.getByRole("link", { name: "Out", exact: true })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Tonight", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(
        await nav
          .locator(".mobileTab")
          .evaluateAll((links) => links.map((link) => link.getAttribute("aria-label"))),
      ).toEqual(["Map", "Tonight", "Plan", "Spoons", "Social", "You"]);
    });
  });
}
