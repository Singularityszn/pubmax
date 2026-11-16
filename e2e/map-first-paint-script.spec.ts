import { expect, test } from "@playwright/test";

const scriptTagWarning =
  "Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client.";

function watchScriptTagWarnings(page: import("@playwright/test").Page): string[] {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes(scriptTagWarning)) {
      warnings.push(message.text());
    }
  });
  return warnings;
}

async function expectMapWarmStarted(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Window & { __pubmaxMapWarm?: unknown }).__pubmaxMapWarm));
}

test.describe("map first-paint script", () => {
  test("loads on a cold /map document without a React script warning", async ({ page }) => {
    const warnings = watchScriptTagWarnings(page);
    const initScriptResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/map-first-paint-init.js",
    );

    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "London pub map" })).toBeVisible();
    expect((await initScriptResponse).ok()).toBe(true);
    await expectMapWarmStarted(page);

    expect(warnings).toEqual([]);
  });

  test("loads after client navigation to /map and starts the first-paint warm", async ({ page }) => {
    const warnings = watchScriptTagWarnings(page);
    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: "Plan a pub crawl" })).toBeVisible();

    const initScriptResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/map-first-paint-init.js",
    );
    await page.getByRole("link", { name: "Explore", exact: true }).click();

    await expect(page).toHaveURL(/\/map$/);
    await expect(page.getByRole("heading", { name: "London pub map" })).toBeVisible();
    expect((await initScriptResponse).ok()).toBe(true);
    await expectMapWarmStarted(page);

    expect(warnings).toEqual([]);
  });
});
