import { expect, test } from "@playwright/test";

import { PERFORMANCE_BUDGETS } from "../lib/performanceBudgets";
import { preparePerfPage, waitForQuietNetwork } from "./helpers/perfMeasurement";
import { expectHydrated, expectStreamedPageSettled } from "./helpers/streamedPage";
import { expectMobileMapShellReady } from "./helpers/mobileMapShell";

test.use({ serviceWorkers: "block" });

// The Drinks budget reserves the first load for Discover's own data. Watching
// real route requests catches eager prefetch even when it races past the budget
// clock. Each coverage link must still navigate when the reader acts.
for (const destination of ["plan", "map"] as const) {
  test(`Discover loads its data before reader intent opens ${destination}`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await preparePerfPage(page, new URL(baseURL!).origin, PERFORMANCE_BUDGETS.method);
    const destinations: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/plan" || path === "/map") destinations.push(path);
    });
    const dataResponses = Promise.all(
      ["/api/whats-on", "/data/discover/board.json", "/api/pint-drops"].map((path) =>
        page.waitForResponse((response) => new URL(response.url()).pathname === path),
      ),
    );

    await page.goto("/drinks");
    await expectStreamedPageSettled(page);
    await dataResponses;
    await waitForQuietNetwork(page, PERFORMANCE_BUDGETS.method);
    expect(destinations, "Discover must not load Plan or Map before reader intent").toEqual([]);

    const coverage = page.getByRole("list", { name: "Representative area coverage" });
    const link = destination === "plan"
      ? coverage.getByRole("link", { name: "Open planner", exact: true })
      : coverage.getByRole("link", { name: /See .* pubs on the map/ }).first();
    await expectHydrated(link);
    const href = await link.getAttribute("href");
    const requested = page.waitForRequest((request) => new URL(request.url()).pathname === `/${destination}`);
    await link.click();
    await requested;
    await expect(page).toHaveURL(new URL(href!, baseURL!).href);
    await expectStreamedPageSettled(page);
    if (destination === "map") {
      await expectMobileMapShellReady(page, 60_000);
    } else {
      await expect(page.locator(".planPage")).toBeVisible();
    }
  });
}
