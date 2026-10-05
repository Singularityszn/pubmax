import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { desktopPlannerDrawer, expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";

for (const drink of ["beer", "wine", "gin"] as const) {
  test(`${drink} plan preserves its drink when shared and reopened`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });
    const stops = "venue-149rmv7,venue-1vle947";
    const response = await page.goto(`/map?drink=${drink}&mode=build&pubs=${stops}`);
    expect(response?.status()).toBe(200);
    const toggle = page.getByRole("button", { name: /^(Plan an outing|Close plan)$/ });
    await expect(async () => {
      if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expectSoleDesktopDrawer(page, "planner");
    const route = desktopPlannerDrawer(page).locator(".routePanel");
    await expect(route.locator(".routeList > li")).toHaveCount(2);
    if (drink === "beer") {
      await expect(route.getByRole("radio", { name: "Pint", exact: true })).toHaveAttribute("aria-checked", "true");
      await expect(route.locator(".routeList")).toContainText("AMSTEL");
      await expect(route.locator(".routeMetrics")).toContainText("£6.15");
      await expect(route.locator(".routeMetrics")).toContainText("known subtotal · 1 of 2 stops priced");
      await expect(route.locator(".routeMetrics")).not.toContainText("estimated round");
      await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(1);
    } else {
      await expect(route.getByRole("heading", { name: `${drink === "wine" ? "Wine" : "Gin"} plan`, exact: true })).toBeVisible();
      await expect(route.locator(".routeMetrics")).toContainText("Not recorded");
      await expect(route.locator(".routeList")).not.toContainText("AMSTEL");
      await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(0);
    }
    await route.locator(".routeHeader").scrollIntoViewIfNeeded();
    await testInfo.attach("selected-drink-plan", { body: await page.screenshot(), contentType: "image/png" });
    await route.getByRole("button", { name: "Start this crawl", exact: true }).click();
    const crawlProgress = route.getByTestId("crawl-progress");
    await crawlProgress.getByRole("button", { name: "Mark complete", exact: true }).click();
    await expect(
      crawlProgress.getByRole("status").filter({ hasText: /^Crawl complete: 2\/2 stops$/ }),
    ).toHaveText("Crawl complete: 2/2 stops");
    const shared = route.getByTestId("crawl-share-open");
    await expect(shared).toBeVisible();
    const href = await shared.getAttribute("href");
    const params = new URL(href!, "http://localhost").searchParams;
    expect(params.get("pubs")).toBe(stops);
    expect(params.get("drink")).toBe(drink);
    await shared.click();
    await page.reload();
    expect(new URL(page.url()).searchParams.get("drink")).toBe(drink);
    await expect(async () => {
      if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expectSoleDesktopDrawer(page, "planner");
    await expect(route.locator(".routeList > li")).toHaveCount(2);
    await expect(route.locator(".routeList > li").nth(0)).toContainText("Duke of York");
    await expect(route.locator(".routeList > li").nth(1)).toContainText("The Sir Christopher Hatton");
    if (drink === "beer") {
      await expect(route.getByRole("radio", { name: "Pint", exact: true })).toHaveAttribute("aria-checked", "true");
      await expect(route.locator(".routeList")).toContainText("AMSTEL");
      await expect(route.locator(".routeMetrics")).toContainText("£6.15");
      await expect(route.locator(".routeMetrics")).toContainText("known subtotal · 1 of 2 stops priced");
      await expect(route.locator(".routeMetrics")).not.toContainText("estimated round");
      await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(1);
    } else {
      await expect(route.getByRole("heading", { name: `${drink === "wine" ? "Wine" : "Gin"} plan`, exact: true })).toBeVisible();
      await expect(route.locator(".routeMetrics")).toContainText("Not recorded");
      await expect(route.locator(".routeList")).not.toContainText("AMSTEL");
      await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(0);
    }
    await testInfo.attach("reopened-drink-plan", { body: await page.screenshot(), contentType: "image/png" });
  });
}

async function openPhonePlanner(page: Page, search = "drink=wine") {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  const response = await page.goto(`/map?${search}`);
  expect(response?.status()).toBe(200);
  const intent = page.locator(".mapDrawer.left .mobilePlannerIntent");
  const toggle = page.getByRole("button", { name: "Describe the outing", exact: true });
  await expect(async () => {
    if (!(await intent.isVisible())) await toggle.click();
    await expect(intent).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await intent.getByRole("combobox", { name: "Stops", exact: true }).selectOption("2");
  return intent;
}

const phoneRequests = [
  { name: "the Wine map default", query: "Soho", category: "wine", zeroProof: false, alcoholFree: false },
  { name: "an explicit Gin request", query: "Gin in Soho", category: "gin", zeroProof: false, alcoholFree: false },
  { name: "an explicit no-alcohol request", query: "No alcohol tonight in Soho", category: null, zeroProof: true, alcoholFree: false },
  { name: "the Alcohol-free control", query: "Soho", category: null, zeroProof: true, alcoholFree: true },
] as const;

for (const scenario of phoneRequests) {
  test(`phone generation respects ${scenario.name}`, async ({ page }, testInfo) => {
    const intent = await openPhonePlanner(page);
    await intent.getByRole("textbox", { name: "Describe the outing", exact: true }).fill(scenario.query);
    if (scenario.alcoholFree) {
      const control = intent.getByRole("button", { name: "Alcohol-free", exact: true });
      await control.click();
      await expect(control).toHaveAttribute("aria-pressed", "true");
    }
    const generatedResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/plans/generate" &&
      response.request().method() === "POST",
    );
    await intent.getByRole("button", { name: "Make a plan", exact: true }).click();
    const response = await generatedResponse;
    const sent = response.request().postDataJSON() as { query: string; context: Record<string, unknown> };
    expect(sent.query).toBe(scenario.query);
    if (scenario.name === "the Wine map default") {
      expect(sent.context.drinkCategory).toBe("wine");
    } else {
      expect(sent.context).not.toHaveProperty("drinkCategory");
    }
    expect(response.status()).toBe(200);
    const body = await response.json() as {
      inferredContext: { drinkCategory: string | null; zeroProof: boolean };
      stops: Array<{ venueId: string }>;
    };
    expect(body.inferredContext.drinkCategory).toBe(scenario.category);
    expect(body.inferredContext.zeroProof).toBe(scenario.zeroProof);
    expect(body.stops).toHaveLength(2);
    const result = intent.locator(".mobilePlannerResult");
    await expect(result).toBeVisible();
    await expect(result.locator(".mobilePlannerConfidence")).not.toContainText("one recorded pint");
    if (!scenario.zeroProof) {
      await expect(result.locator(".mobilePlannerConfidence")).toContainText("Selected-drink servings are not recorded.");
    }
    await result.scrollIntoViewIfNeeded();
    await testInfo.attach("phone-drink-plan", { body: await page.screenshot(), contentType: "image/png" });
  });
}

test("phone planner refuses an unsupported Gin brand before requesting a generic plan", async ({ page }, testInfo) => {
  let generationRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/plans/generate" && request.method() === "POST") {
      generationRequests += 1;
    }
  });
  const intent = await openPhonePlanner(page, "drink=gin&brand=sipsmith");
  await intent.getByRole("button", { name: "Make a plan", exact: true }).click();
  const alert = intent.getByRole("alert");
  await expect(alert).toContainText("The planner cannot match Sipsmith yet.");
  expect(generationRequests).toBe(0);
  await alert.scrollIntoViewIfNeeded();
  await testInfo.attach("phone-unsupported-drink", { body: await page.screenshot(), contentType: "image/png" });
});


test("generated Gin replaces the previous Wine map context", async ({ page }, testInfo) => {
  const intent = await openPhonePlanner(page);
  await intent.getByRole("textbox", { name: "Describe the outing", exact: true }).fill("Gin in Soho");
  const generatedResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/plans/generate" && response.request().method() === "POST",
  );
  await intent.getByRole("button", { name: "Make a plan", exact: true }).click();
  const response = await generatedResponse;
  expect(response.status()).toBe(200);
  const body = await response.json() as { inferredContext: { drinkCategory: string | null }; stops: Array<{ venueId: string }> };
  expect(body.inferredContext.drinkCategory).toBe("gin");
  expect(body.stops).toHaveLength(2);
  const route = page.locator(".mapDrawer.left .routePanel");
  await expect(route.locator(".routeList > li")).toHaveCount(2);
  await expect(page).toHaveURL(/[?&]drink=gin(?:&|$)/);
  await expect(route.getByRole("heading", { name: "Gin plan", exact: true })).toBeVisible();
  await expect(route.locator(".routeMetrics")).toContainText("Not recorded");
  await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(0);
  await route.locator(".routeHeader").scrollIntoViewIfNeeded();
  await testInfo.attach("generated-drink-activation", { body: await page.screenshot(), contentType: "image/png" });
  const calendar = page.waitForEvent("download");
  await route.getByRole("button", { name: "Add to calendar (.ics)", exact: true }).click();
  const download = await calendar;
  const contents = await readFile((await download.path())!, "utf8");
  expect(contents).toContain("SUMMARY:Gin plan");
  expect(contents).toContain("gin stop");
  expect(contents).not.toContain("pint stop");
  await route.getByRole("button", { name: "Start this crawl", exact: true }).click();
  const progress = route.getByTestId("crawl-progress");
  await progress.getByRole("button", { name: "Mark complete", exact: true }).click();
  await expect(progress.getByRole("status").filter({ hasText: /^Crawl complete: 2\/2 stops$/ })).toHaveText("Crawl complete: 2/2 stops");
  const shared = route.getByTestId("crawl-share-open");
  await expect(shared).toBeVisible();
  const href = await shared.getAttribute("href");
  const params = new URL(href!, "http://localhost").searchParams;
  expect(params.get("drink")).toBe("gin");
  expect(params.get("pubs")).toBe(body.stops.map((stop) => stop.venueId).join(","));
  expect(params.has("brand")).toBe(false);
  expect(params.has("sub")).toBe(false);
  await shared.click();
  await page.reload();
  const toggle = page.getByRole("button", { name: "Edit your crawl, 2 stops picked", exact: true });
  await expect(async () => {
    if (!(await route.isVisible())) await toggle.click();
    await expect(route).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(route.getByRole("heading", { name: "Gin plan", exact: true })).toBeVisible();
  await expect(route.locator(".routeList > li")).toHaveCount(2);
  await expect(route.locator(".routeMetrics")).toContainText("Not recorded");
  await testInfo.attach("generated-gin-reopened", { body: await page.screenshot(), contentType: "image/png" });
});


test("generated Alcohol-free replaces the previous Gin refinement", async ({ page }, testInfo) => {
  const intent = await openPhonePlanner(page, "drink=gin&brand=sipsmith");
  await intent.getByRole("textbox", { name: "Describe the outing", exact: true }).fill("Alcohol-free in Soho");
  const generatedResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/plans/generate" && response.request().method() === "POST",
  );
  await intent.getByRole("button", { name: "Make a plan", exact: true }).click();
  const response = await generatedResponse;
  expect(response.status()).toBe(200);
  const body = await response.json() as { inferredContext: { zeroProof: boolean }; stops: Array<{ venueId: string }> };
  expect(body.inferredContext.zeroProof).toBe(true);
  expect(body.stops).toHaveLength(2);
  const route = page.locator(".mapDrawer.left .routePanel");
  await expect(route.locator(".routeList > li")).toHaveCount(2);
  await expect(page).toHaveURL(/[?&]drink=alcohol-free(?:&|$)/);
  expect(new URL(page.url()).searchParams.has("brand")).toBe(false);
  await expect(route.getByRole("heading", { name: "Alcohol-free plan", exact: true })).toBeVisible();
  await expect(route.locator(".routeMetrics")).toContainText("Not recorded");
  await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(0);
  for (const stop of await route.locator(".routeList > li > button").all()) {
    const widths = await stop.evaluate((button) => {
      const caption = button.querySelector("p")!;
      const range = document.createRange();
      range.selectNodeContents(caption);
      const bounds = button.getBoundingClientRect();
      const text = range.getBoundingClientRect();
      return { client: button.clientWidth, content: button.scrollWidth, left: bounds.left, right: bounds.right, textLeft: text.left, textRight: text.right };
    });
    expect(widths.content).toBeLessThanOrEqual(widths.client);
    expect(widths.textLeft).toBeGreaterThanOrEqual(widths.left);
    expect(widths.textRight).toBeLessThanOrEqual(widths.right);
  }
  await route.locator(".routeHeader").scrollIntoViewIfNeeded();
  await testInfo.attach("generated-alcohol-free-activation", { body: await page.screenshot(), contentType: "image/png" });
});


test("generated Beer clears the previous Gin brand and style", async ({ page }, testInfo) => {
  const intent = await openPhonePlanner(page, "drink=gin&brand=sipsmith&sub=gin-london-dry");
  await intent.getByRole("textbox", { name: "Describe the outing", exact: true }).fill("Beer in Soho");
  const generatedResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/plans/generate" && response.request().method() === "POST",
  );
  await intent.getByRole("button", { name: "Make a plan", exact: true }).click();
  const response = await generatedResponse;
  expect(response.status()).toBe(200);
  const body = await response.json() as { inferredContext: { drinkCategory: string }; stops: Array<{ venueId: string }> };
  expect(body.inferredContext.drinkCategory).toBe("beer");
  const route = page.locator(".mapDrawer.left .routePanel");
  await expect(route.locator(".routeList > li")).toHaveCount(2);
  await expect(page).toHaveURL(/[?&]drink=beer(?:&|$)/);
  const params = new URL(page.url()).searchParams;
  expect(params.has("brand")).toBe(false);
  expect(params.has("sub")).toBe(false);
  await expect(route.getByRole("radio", { name: "Pint", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(1);
  await testInfo.attach("generated-beer-activation", { body: await page.screenshot(), contentType: "image/png" });
});
