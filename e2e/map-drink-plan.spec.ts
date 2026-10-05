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
    if (drink === "beer") {
      await expect(route.getByRole("button", { name: "Hide line", exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    // Observe the shared intent after the map's 300 ms URL debounce, not only
    // immediately after reload. This also checks what the visible Copy link sends.
    await page.waitForTimeout(600);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await route.locator(".routeHeader").scrollIntoViewIfNeeded();
    const copyLink = route.getByRole("button", { name: "Copy a shareable link to this crawl", exact: true });
    await copyLink.click();
    await expect(copyLink).toHaveText("Copied");
    const copiedLink = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    await testInfo.attach("reopened-share-context", {
      body: Buffer.from(JSON.stringify({
        locationDrink: new URL(page.url()).searchParams.get("drink"),
        copiedDrink: copiedLink.searchParams.get("drink"),
        copiedStops: copiedLink.searchParams.get("pubs"),
      })),
      contentType: "application/json",
    });
    expect(new URL(page.url()).searchParams.get("drink")).toBe(drink);
    expect(copiedLink.searchParams.get("drink")).toBe(drink);
    expect(copiedLink.searchParams.get("pubs")).toBe(stops);
    await testInfo.attach("reopened-drink-plan", { body: await page.screenshot(), contentType: "image/png" });
  });
}

test("ordinary Beer plans keep their default URL after synchronization and copying", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  const stops = "venue-149rmv7,venue-1vle947";
  const response = await page.goto(`/map?mode=build&pubs=${stops}`);
  expect(response?.status()).toBe(200);
  const toggle = page.getByRole("button", { name: /^(Plan an outing|Close plan)$/ });
  await expect(async () => {
    if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expectSoleDesktopDrawer(page, "planner");
  const route = desktopPlannerDrawer(page).locator(".routePanel");
  await expect(route.locator(".routeList > li")).toHaveCount(2);
  await expect(route.getByRole("radio", { name: "Pint", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(600);
  expect(new URL(page.url()).searchParams.get("drink")).toBeNull();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await route.locator(".routeHeader").scrollIntoViewIfNeeded();
  const copyLink = route.getByRole("button", { name: "Copy a shareable link to this crawl", exact: true });
  await copyLink.click();
  await expect(copyLink).toHaveText("Copied");
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copied.searchParams.get("drink")).toBeNull();
  expect(copied.searchParams.get("pubs")).toBe(stops);
});

for (const curated of [
  { id: "victorian-soho", radio: "Pint", style: "heritage", alt: null },
  { id: "soho-food-crawl", radio: "Food", style: null, alt: "food" },
] as const) {
  test(`${curated.id} Beer shares retain their drink through catalogue hydration and copying`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });
    // Existing curated shares carry the catalogue identity and ordered stops,
    // without a style. The catalogue supplies style or Food after mount.
    const stops = "venue-1ufn31x,venue-1t8siin,venue-xiesdn,venue-phqazo,venue-15i2wst";
    const response = await page.goto(`/map?drink=beer&mode=build&pubs=${stops}&crawl=${curated.id}`);
    expect(response?.status()).toBe(200);
    const toggle = page.getByRole("button", { name: /^(Plan an outing|Close plan)$/ });
    await expect(async () => {
      if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expectSoleDesktopDrawer(page, "planner");
    const route = desktopPlannerDrawer(page).locator(".routePanel");
    await expect(route.locator(".routeList > li")).toHaveCount(5);
    await expect(route.getByRole("radio", { name: curated.radio, exact: true })).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("style")).toBe(curated.style);
    await expect.poll(() => new URL(page.url()).searchParams.get("alt")).toBe(curated.alt);
    await page.waitForTimeout(600);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await route.locator(".routeHeader").scrollIntoViewIfNeeded();
    const copyLink = route.getByRole("button", { name: "Copy a shareable link to this crawl", exact: true });
    await copyLink.click();
    await expect(copyLink).toHaveText("Copied");
    const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    await testInfo.attach("curated-share-context", {
      body: Buffer.from(JSON.stringify({
        location: page.url(), copied: copied.toString(),
      })),
      contentType: "application/json",
    });
    expect(new URL(page.url()).searchParams.get("drink")).toBe("beer");
    expect(copied.searchParams.get("drink")).toBe("beer");
    expect(copied.searchParams.get("pubs")).toBe(stops);
    expect(copied.searchParams.get("style")).toBe(curated.style);
    expect(copied.searchParams.get("alt")).toBe(curated.alt);
    expect(copied.searchParams.get("crawl")).toBe(curated.id);
    await page.goto(copied.toString());
    await page.reload();
    await expect.poll(() => new URL(page.url()).searchParams.get("style")).toBe(curated.style);
    await expect.poll(() => new URL(page.url()).searchParams.get("alt")).toBe(curated.alt);
    await page.waitForTimeout(600);
    expect(new URL(page.url()).searchParams.get("drink")).toBe("beer");
    expect(new URL(page.url()).searchParams.get("pubs")).toBe(stops);
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
  const intent = await openPhonePlanner(page, "drink=gin&brand=sipsmith&sub=gin-london-dry&alt=mocktail");
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
  await expect(page).not.toHaveURL(/[?&]drink=gin(?:&|$)/);
  const params = new URL(page.url()).searchParams;
  expect(params.get("drink")).toBeNull();
  expect(params.has("brand")).toBe(false);
  expect(params.has("sub")).toBe(false);
  await expect(route.getByRole("radio", { name: "Pint", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(1);
  const calendar = page.waitForEvent("download");
  await route.getByRole("button", { name: "Add to calendar (.ics)", exact: true }).click();
  const download = await calendar;
  const contents = await readFile((await download.path())!, "utf8");
  expect(contents).toContain("pint stop");
  expect(contents).not.toContain("mocktail stop");
  await testInfo.attach("generated-beer-activation", { body: await page.screenshot(), contentType: "image/png" });
});


test("generated Cocktail uses the map's Cocktail filter policy", async ({ page }) => {
  const intent = await openPhonePlanner(page);
  await intent.getByRole("textbox", { name: "Describe the outing", exact: true }).fill("Cocktails in Soho");
  const generatedResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/plans/generate" && response.request().method() === "POST",
  );
  await intent.getByRole("button", { name: "Make a plan", exact: true }).click();
  const response = await generatedResponse;
  expect(response.status()).toBe(200);
  const body = await response.json() as { inferredContext: { drinkCategory: string } };
  expect(body.inferredContext.drinkCategory).toBe("cocktail");
  await expect(page).toHaveURL(/[?&]drink=cocktail(?:&|$)/);
  await page.getByRole("button", { name: "Close planner", exact: true }).click();
  const filtersButton = page.getByRole("button", { name: /^Filters/ });
  await filtersButton.click();
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("group", { name: "Filter by drink shape" }).getByRole("button", { name: "Cocktails (selected)", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("Top shelf Beer plan keeps its refinement and unknown money through share and reopen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  const stops = "venue-149rmv7,venue-1vle947";
  const response = await page.goto(`/map?drink=beer&topshelf=1&mode=build&pubs=${stops}`);
  expect(response?.status()).toBe(200);
  const toggle = page.getByRole("button", { name: /^(Plan an outing|Close plan)$/ });
  const openPlanner = async () => {
    await expect(async () => {
      if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expectSoleDesktopDrawer(page, "planner");
  };
  const route = desktopPlannerDrawer(page).locator(".routePanel");
  const expectTopShelfPlan = async () => {
    await expect(route.locator(".routeList > li")).toHaveCount(2);
    await expect(route.getByRole("heading", { name: "Top shelf beer plan", exact: true })).toBeVisible();
    await expect(route.locator(".routeList > li").nth(0)).toContainText("Top shelf beer price unknown here. Ask at the bar.");
    await expect(route.locator(".routeList")).not.toContainText("AMSTEL");
    await expect(route.locator(".routeList")).not.toContainText("no Top shelf beer price");
    await expect(route.locator(".routeMetrics")).toContainText("Not recorded");
    await expect(route.locator(".routeMetrics")).toContainText("top shelf beer stops");
    await expect(route.locator(".routeMetrics")).not.toContainText("£6.15");
    await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(0);
  };
  await openPlanner();
  await expectTopShelfPlan();
  await route.locator(".routeHeader").scrollIntoViewIfNeeded();
  await testInfo.attach("top-shelf-plan", { body: await page.screenshot(), contentType: "image/png" });
  await route.getByRole("button", { name: "Start this crawl", exact: true }).click();
  const crawlProgress = route.getByTestId("crawl-progress");
  await crawlProgress.getByRole("button", { name: "Mark complete", exact: true }).click();
  await expect(
    crawlProgress.getByRole("status").filter({ hasText: /^Crawl complete: 2\/2 stops$/ }),
  ).toHaveText("Crawl complete: 2/2 stops");
  const shared = route.getByTestId("crawl-share-open");
  await expect(shared).toBeVisible();
  const params = new URL((await shared.getAttribute("href"))!, "http://localhost").searchParams;
  expect(params.get("drink")).toBe("beer");
  expect(params.get("topshelf")).toBe("1");
  expect(params.get("pubs")).toBe(stops);
  await shared.click();
  await page.reload();
  await openPlanner();
  await expectTopShelfPlan();
  await page.waitForTimeout(600);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await route.locator(".routeHeader").scrollIntoViewIfNeeded();
  const copyLink = route.getByRole("button", { name: "Copy a shareable link to this crawl", exact: true });
  await copyLink.click();
  await expect(copyLink).toHaveText("Copied");
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copied.searchParams.get("drink")).toBe("beer");
  expect(copied.searchParams.get("topshelf")).toBe("1");
  expect(copied.searchParams.get("pubs")).toBe(stops);
  await testInfo.attach("top-shelf-reopened", { body: await page.screenshot(), contentType: "image/png" });
});

test("phone planner refuses a Top shelf Beer default before requesting a generic plan", async ({ page }) => {
  let generationRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/plans/generate" && request.method() === "POST") {
      generationRequests += 1;
    }
  });
  const intent = await openPhonePlanner(page, "drink=beer&topshelf=1");
  await intent.getByRole("textbox", { name: "Describe the outing", exact: true }).fill("Soho");
  await intent.getByRole("button", { name: "Make a plan", exact: true }).click();
  await expect(intent.getByRole("alert")).toContainText(
    "The planner cannot match Top shelf beer yet. Turn off Top shelf on the map, or name a different drink.",
  );
  expect(generationRequests).toBe(0);
});

test("phone generation from the No-alcohol view stays zero-proof", async ({ page }) => {
  const intent = await openPhonePlanner(page, "experience=no-alcohol");
  await intent.getByRole("textbox", { name: "Describe the outing", exact: true }).fill("Soho");
  const generatedResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/plans/generate" && response.request().method() === "POST",
  );
  await intent.getByRole("button", { name: "Make a plan", exact: true }).click();
  const response = await generatedResponse;
  const sent = response.request().postDataJSON() as { context: Record<string, unknown> };
  expect(sent.context.zeroProof).toBe(true);
  expect(sent.context).not.toHaveProperty("drinkCategory");
  expect(response.status()).toBe(200);
  const body = await response.json() as { inferredContext: { zeroProof: boolean; drinkCategory: string | null } };
  expect(body.inferredContext.zeroProof).toBe(true);
  expect(body.inferredContext.drinkCategory).toBeNull();
  const route = page.locator(".mapDrawer.left .routePanel");
  await expect(route.locator(".routeList > li")).toHaveCount(2);
  await expect(page).toHaveURL(/[?&]drink=alcohol-free(?:&|$)/);
  await expect(route.getByRole("heading", { name: "Alcohol-free plan", exact: true })).toBeVisible();
  await expect(route.locator(".routeList")).not.toContainText("AMSTEL");
});

for (const generated of [
  { query: "Beer in Soho", category: "beer" },
  { query: "Gin in Soho", category: "gin" },
] as const) {
  test(`generated ${generated.category} keeps the saved favourite pint`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("pubmax:favoritePint:v1", "estrella"));
    const intent = await openPhonePlanner(page);
    await intent.getByRole("textbox", { name: "Describe the outing", exact: true }).fill(generated.query);
    const generatedResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/plans/generate" && response.request().method() === "POST",
    );
    await intent.getByRole("button", { name: "Make a plan", exact: true }).click();
    const response = await generatedResponse;
    expect(response.status()).toBe(200);
    const body = await response.json() as { inferredContext: { drinkCategory: string } };
    expect(body.inferredContext.drinkCategory).toBe(generated.category);
    const route = page.locator(".mapDrawer.left .routePanel");
    await expect(route.locator(".routeList > li")).toHaveCount(2);
    if (generated.category === "gin") {
      await expect(route.getByRole("heading", { name: "Gin plan", exact: true })).toBeVisible();
    } else {
      await expect(route.getByRole("radio", { name: "Pint", exact: true })).toHaveAttribute("aria-checked", "true");
    }
    expect(await page.evaluate(() => localStorage.getItem("pubmax:favoritePint:v1"))).toBe("estrella");
  });
}

test("London dry gin plan keeps its proper name in stop counts and the calendar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  const response = await page.goto("/map?drink=gin&sub=gin-london-dry&mode=build&pubs=venue-149rmv7,venue-1vle947");
  expect(response?.status()).toBe(200);
  const toggle = page.getByRole("button", { name: /^(Plan an outing|Close plan)$/ });
  await expect(async () => {
    if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expectSoleDesktopDrawer(page, "planner");
  const route = desktopPlannerDrawer(page).locator(".routePanel");
  await expect(route.locator(".routeList > li")).toHaveCount(2);
  await expect(route.getByRole("heading", { name: "London dry gin plan", exact: true })).toBeVisible();
  await expect(route.locator(".routeMetrics")).toContainText("London dry gin stops");
  await expect(route.locator(".routeMetrics")).not.toContainText("london dry gin");
  const calendar = page.waitForEvent("download");
  await route.getByRole("button", { name: "Add to calendar (.ics)", exact: true }).click();
  const contents = await readFile((await (await calendar).path())!, "utf8");
  expect(contents).toContain("SUMMARY:London dry gin plan");
  expect(contents).toContain("London dry gin stop");
  expect(contents).not.toContain("london dry gin stop");
});
