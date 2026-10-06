import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

for (const city of ["manchester", "london"] as const) {
  test(`${city} mobile map only offers its own live transport after reconnect`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    let recovered = false;
    if (city === "london") {
      await page.route("**/api/citymcp/status", (route) => route.fulfill({
        status: recovered ? 200 : 503,
        json: recovered
          ? { tubeLines: [{ line: "Victoria", status: "Minor delays", disruption: "Service recovering after signal repairs." }] }
          : { error: "Unavailable" },
      }));
    } else {
      await page.route("**/api/citymcp/status**", () => {
        throw new Error("a non-London map must not call live city status");
      });
      await page.route("**/api/tfl-disruption**", () => {
        throw new Error("a non-London map must not call TfL");
      });
    }
    const statusRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/citymcp/status") {
        statusRequests.push(request.url());
      }
    });

    await page.goto(`/map/${city}`);
    await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    const tflButton = page.getByRole("button", { name: /TfL live/ });

    if (city === "london") {
      await expect(tflButton).toBeVisible();
      await expect.poll(() => statusRequests.length).toBeGreaterThan(0);
    } else {
      await expect(tflButton).toHaveCount(0);
      expect(statusRequests).toEqual([]);
      await expect(page.getByRole("button", { name: "Near me" })).toBeVisible();
    }

    await expect(async () => {
      await page.getByRole("button", { name: "More map controls" }).click();
      await expect(page.locator('.mobileSheetPortal[data-sheet-kind="layers"]')).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    const transitTab = page.getByRole("tab", { name: "Transit" });
    if (city === "london") {
      await expect(transitTab).toBeVisible();
      await transitTab.click();
      await expect(page.getByText("TfL updates are unavailable.", { exact: true })).toBeVisible();
    } else {
      await expect(transitTab).toHaveCount(0);
    }

    const beforeReconnect = statusRequests.length;
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    recovered = true;
    await context.setOffline(false);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);

    if (city === "london") {
      await expect(page.locator(".mobileTflGroups")).toContainText("Service recovering after signal repairs.");
      expect(statusRequests.length).toBeGreaterThan(beforeReconnect);
      await expect(page.getByText("TfL updates are unavailable.", { exact: true })).toHaveCount(0);
    } else {
      expect(statusRequests).toEqual([]);
      await expect(transitTab).toHaveCount(0);
      await expect(tflButton).toHaveCount(0);
    }
    await page.screenshot({ path: testInfo.outputPath(`${city}-transport-reconnected.png`) });
    await testInfo.attach("transport-requests", {
      body: JSON.stringify({ city, beforeReconnect, afterReconnect: statusRequests.length, statusRequests }),
      contentType: "application/json",
    });
  });
}
