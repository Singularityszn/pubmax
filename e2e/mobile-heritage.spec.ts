import { expect, test } from "@playwright/test";

test("mobile historic index and detail stay provenance-honest and map-linked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const indexResponse = await page.goto("/historic");
  expect(indexResponse?.status()).toBe(200);

  await expect(
    page.getByRole("heading", { name: "London’s historic pubs" }),
  ).toBeVisible();
  await expect(page.getByText(/cited from Wikipedia and Wikidata/i)).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /Showing \d+-\d+ of \d+ pubs/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Listed only" })).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Listed only" }).click();
  await expect(page.getByRole("button", { name: "Listed only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("status").filter({ hasText: /Showing \d+-\d+ of \d+ matches/i }),
  ).toBeVisible();

  await page.getByRole("heading", { level: 2 }).first().getByRole("link").click();
  await expect(page).toHaveURL(/\/historic\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "On record" })).toBeVisible();
  await expect(page.getByText(/Cited from Wikipedia and Wikidata/i)).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);

  await page.getByRole("link", { name: /Open on the map/i }).click();
  await expect(page).toHaveURL(/\/map\?sel=venue-/);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".mapDrawer.right")).toHaveClass(/open/);
});

test("mobile historic story actions keep 44px tap targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const indexResponse = await page.goto("/historic");
  expect(indexResponse?.status()).toBe(200);

  const cardActions = page.getByRole("heading", { level: 2 }).first().getByRole("link");
  await expect(cardActions).toBeVisible();
  await expect
    .poll(async () =>
      cardActions.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    )
    .toBeGreaterThanOrEqual(44);

  const indexMap = page.getByRole("link", { name: /^See .+ on the map$/ }).first();
  await expect(indexMap).toBeVisible();
  const indexMapBox = await indexMap.boundingBox();
  expect(indexMapBox).not.toBeNull();
  expect(indexMapBox!.width).toBeGreaterThanOrEqual(44);
  expect(indexMapBox!.height).toBeGreaterThanOrEqual(44);

  await cardActions.click();
  await expect(page).toHaveURL(/\/historic\/[a-z0-9-]+$/);

  const detailActions = page.getByRole("region", { name: "Explore this pub" }).getByRole("link");
  await expect(detailActions.first()).toBeVisible();
  const actionHeights = await detailActions.evaluateAll((links) =>
    links.map((link) => Math.round(link.getBoundingClientRect().height)),
  );

  for (const height of actionHeights) {
    expect(height).toBeGreaterThanOrEqual(44);
  }
});

test("the historic index map link opens its named pub", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto("/historic");
  const story = page.getByRole("heading", { level: 2 }).first().getByRole("link");
  const name = await story.innerText();
  const mapLink = page.getByRole("link", { name: `See ${name} on the map`, exact: true });
  const href = await mapLink.getAttribute("href");
  expect(href).toMatch(/^\/map\?sel=venue-/);
  await mapLink.click();
  await expect(page).toHaveURL(new URL(href!, page.url()).toString());
  await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name, exact: true }).getByRole("heading", { name, exact: true })).toBeVisible();
});
