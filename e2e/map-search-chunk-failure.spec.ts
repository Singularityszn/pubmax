import { expect, test } from "@playwright/test";

// A lost chunk for the lazy Search panel stays inside the panel. It used to
// reach app/error.tsx and replace the whole map with "Spilled." (QA finding F03).
// The chunk is found by its content, so the spec follows the panel wherever the
// bundler puts it.

const PANEL_MARKER = "Search suggestions";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}: a failed search chunk shows its own retry and the map stays up`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    let refuse = false;
    let refused = 0;
    await context.route("**/_next/static/chunks/**", async (route) => {
      if (!refuse || !route.request().url().includes(".js")) return route.continue();
      const response = await route.fetch();
      if ((await response.text()).includes(PANEL_MARKER)) {
        refused += 1;
        return route.abort("failed");
      }
      return route.fulfill({ response });
    });

    // The desktop toolbar mounts the search with the page, so its chunk is
    // refused from the first request. The phone opens it on a tap.
    refuse = viewport.name === "desktop";
    await page.goto("/map");
    await expect(page.locator("canvas.maplibregl-canvas").first()).toBeVisible({
      timeout: 45_000,
    });
    if (viewport.name === "phone") {
      await page.waitForTimeout(3_000);
      refuse = true;
      await page.getByRole("button", { name: /search/i }).first().click();
    }

    const failed = page.locator(".lazyPanelFailed");
    await expect(failed).toBeVisible({ timeout: 20_000 });
    await expect(failed).toContainText("Search did not open.");
    expect(refused).toBeGreaterThan(0);
    // The map is still the page: no app error screen.
    await expect(page.getByRole("heading", { name: "Spilled." })).toHaveCount(0);
    await expect(page.locator("canvas.maplibregl-canvas").first()).toBeVisible();

    refuse = false;
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("combobox")).toBeVisible({ timeout: 20_000 });
    await expect(failed).toHaveCount(0);
  });
}
