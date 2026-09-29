import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

for (const city of ["manchester", "london"] as const) {
  test(`${city} mobile map only offers its own live transport`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    const statusRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/citymcp/status") {
        statusRequests.push(request.url());
      }
    });

    await page.goto(`/map/${city}`);
    await expect(page.locator(".mobileMapTopbar")).toBeVisible();
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    const tflButton = page.getByRole("button", { name: /TfL live/ });

    if (city === "london") {
      await expect(tflButton).toBeVisible();
      await expect.poll(() => statusRequests.length).toBeGreaterThan(0);
    } else {
      await expect(tflButton).toHaveCount(0);
      await page.waitForTimeout(1_000);
      expect(statusRequests).toEqual([]);
      await expect(page.getByRole("button", { name: "Near me" })).toBeVisible();
    }

    await page.getByRole("button", { name: "More map controls" }).click();
    const transitTab = page.getByRole("tab", { name: "Transit" });
    if (city === "london") {
      await expect(transitTab).toBeVisible();
      await transitTab.click();
      await expect(page.locator(".mobileTflGroups, .mobileSheetEmpty").first()).toBeVisible();
    } else {
      await expect(transitTab).toHaveCount(0);
    }
  });
}
