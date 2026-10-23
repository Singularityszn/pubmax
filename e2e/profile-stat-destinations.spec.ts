import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`${width}px: an empty public profile never links to an absent section`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/profiles/emptystats**", (route) => route.fulfill({ json: {
      profile: { id: "50000000-0000-4000-8000-000000000099", handle: "emptystats", displayName: "Empty public profile", visibility: "public" },
      projection: "full", socialLinks: [], counts: { followers: 0, following: 0 },
    } }));
    await page.goto("/u/emptystats");
    await expect(page.getByRole("heading", { name: "Empty public profile", exact: true }).first()).toBeVisible();
    const stats = page.getByRole("list", { name: "Profile statistics", exact: true });
    await expect(stats).toBeVisible();
    await expect(page.getByText("This passport is blank, for now.", { exact: true })).toBeVisible();
    await expect(stats.getByRole("link", { name: /^(Pints logged|Cheapest pint|Crawls|Memories):/ })).toHaveCount(0);
    await expect(stats.getByRole("listitem")).toHaveCount(6);
    const badAnchors = await stats.locator('a[href*="#"]').evaluateAll((links) => links.filter((link) => {
      const hash = new URL((link as HTMLAnchorElement).href).hash;
      return hash && !document.getElementById(hash.slice(1));
    }).map((link) => link.getAttribute("href")));
    expect(badAnchors).toEqual([]);
  });
}
