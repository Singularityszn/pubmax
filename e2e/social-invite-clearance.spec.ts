import { expect, test } from "@playwright/test";

for (const width of [390, 430]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`signed-out Social invite at ${width}px in ${colorScheme}`, () => {
      test.use({
        viewport: { width, height: 844 },
        colorScheme,
        storageState: { cookies: [], origins: [] },
      });

      test("keeps the invite action out of the Create FAB lane", async ({ page }) => {
        await page.addInitScript(() => {
          localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        });
        await page.goto("/social");
        const invite = page.getByRole("link", { name: "Sign in to invite", exact: true });
        await expect(invite).toBeVisible();
        await expect(page.locator(".createFab")).toBeVisible();

        // The feed-first layout moves this control later in the document.
        // Scroll it through the FAB's band, as a reader reaching the rail does.
        await invite.evaluate((action) => {
          const box = action.getBoundingClientRect();
          const fab = document.querySelector(".createFab")!.getBoundingClientRect();
          window.scrollBy(0, box.y + box.height / 2 - fab.y - fab.height / 2);
        });
        await expect.poll(() => invite.evaluate((action) => {
          const box = action.getBoundingClientRect();
          const fab = document.querySelector(".createFab")!.getBoundingClientRect();
          return fab.left - box.right;
        })).toBeGreaterThanOrEqual(0);

        const pointsAreOwned = await invite.evaluate((action) => {
          const box = action.getBoundingClientRect();
          return [0.1, 0.5, 0.9].every((x) => [0.2, 0.5, 0.8].every((y) => {
            const hit = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y);
            return hit !== null && action.contains(hit);
          }));
        });
        expect(pointsAreOwned).toBe(true);
        await invite.click({ trial: true });
      });
    });
  }
}
