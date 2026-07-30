import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORT = { width: 390, height: 844 };
const CHIP_LABELS = ["Beer", "Wine", "Cocktails", "Whisky", "Gin", "Rum"];

test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function openFilters(page: Page): Promise<Locator> {
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  const filtersButton = page.getByRole("button", { name: /^Filters/ });
  await expect(filtersButton).toBeVisible({ timeout: 45_000 });
  await filtersButton.click();

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  await expect(sheet).toBeVisible();
  return sheet;
}

async function pressedLabels(group: Locator): Promise<string[]> {
  return group.locator('button[aria-pressed="true"]').evaluateAll((buttons) =>
    buttons.map((button) => {
      const label = button.getAttribute("aria-label");
      return (label ?? button.textContent ?? "").replace(" (selected)", "").trim();
    }),
  );
}

test("390px drink chip labels contain category names only", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sheet = await openFilters(page);
  const shapeGroup = sheet.getByRole("group", { name: "Filter by drink shape" });

  await expect(shapeGroup.getByRole("button")).toHaveText(CHIP_LABELS);
});

test("390px Prices and places controls show one truthful selection", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sheet = await openFilters(page);
  const shapeGroup = sheet.getByRole("group", { name: "Filter by drink shape" });
  const mapViewGroup = sheet.getByRole("group", { name: "Map view" });

  await shapeGroup.getByRole("button", { name: "Gin", exact: true }).click();
  await expect(page).toHaveURL(/[?&]drink=gin(?:&|$)/);
  expect([
    ...(await pressedLabels(mapViewGroup)),
    ...(await pressedLabels(shapeGroup)),
  ]).toEqual(["Gin"]);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`${viewport.width}px Prices and places exposes derived map key rows`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const sheet = await openFilters(page);
    const key = sheet.getByLabel("Map key");
    const heading = key.getByRole("heading", {
      name: "Pint prices and other venue price bands",
    });

    await heading.scrollIntoViewIfNeeded();
    await expect(key).toBeVisible();
    await expect(heading).toBeVisible();
    await expect(key.locator(".mapKeyPriceRows li")).toHaveText([
      "££5.50 or less; low for its venue type",
      "££Over £5.50, up to £7; middle for its venue type",
      "£££Over £7; high for its venue type",
      "?No pint price on the map",
    ]);
  });
}

test("persisted favourite pint keeps All unselected after mobile and desktop reloads", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await page.evaluate(() => {
    window.localStorage.setItem("pubmax:favoritePint:v1", "guinness");
  });

  await page.reload();
  const filtersButton = page.getByRole("button", { name: /^Filters/ });
  await expect(filtersButton).toBeVisible({ timeout: 45_000 });
  await filtersButton.click();
  const mobileSheet = page.locator(
    '.mobileSheetPortal[data-sheet-kind="filters"]',
  );
  await expect(mobileSheet).toBeVisible();
  await expect(
    mobileSheet.getByLabel("Favourite pint or beer brand"),
  ).toHaveValue("guinness");
  await expect(
    mobileSheet
      .getByRole("group", { name: "Map view" })
      .getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  const desktopToolbar = page.locator(".mapToolbar");
  await expect(desktopToolbar).toBeVisible({ timeout: 45_000 });
  await expect(
    desktopToolbar.getByLabel("Favourite pint or beer brand"),
  ).toHaveValue("guinness");
  await expect(
    desktopToolbar
      .getByRole("group", { name: "Map view" })
      .getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("390px fare-zone rows agree through selection and reset", async ({ page }) => {
  test.setTimeout(90_000);
  const sheet = await openFilters(page);
  const zoneGroup = sheet.getByRole("group", { name: "Filter by fare zone" });
  const zonePriceGroup = sheet.getByRole("list", {
    name: "Median pint price by fare zone",
  });

  expect(await pressedLabels(zoneGroup)).toEqual(["All"]);
  expect(await pressedLabels(zonePriceGroup)).toEqual([]);

  await zoneGroup.getByRole("button", { name: "Zone 5", exact: true }).click();
  expect(await pressedLabels(zoneGroup)).toEqual(["Zone 5"]);
  const pressedPriceLabels = await pressedLabels(zonePriceGroup);
  expect(pressedPriceLabels).toHaveLength(1);
  expect(pressedPriceLabels[0]).toMatch(/^Zone 5£\d/);

  await zoneGroup.getByRole("button", { name: "All", exact: true }).click();
  expect(await pressedLabels(zoneGroup)).toEqual(["All"]);
  expect(await pressedLabels(zonePriceGroup)).toEqual([]);

  const zoneFivePrice = zonePriceGroup.locator('button[title^="Zone 5:"]');
  const zoneFiveChip = zoneGroup.getByRole("button", {
    name: "Zone 5",
    exact: true,
  });
  expect(
    await zoneFivePrice.evaluate((button) => getComputedStyle(button).borderColor),
  ).toBe(
    await zoneFiveChip.evaluate((button) => getComputedStyle(button).borderColor),
  );
});

test("390px zone figures state their calculation and assignment basis", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sheet = await openFilters(page);

  await expect(
    sheet.getByText(
      "Each zone figure is the median of the cheapest recorded pint price for pubs assigned to that zone.",
    ),
  ).toBeVisible();
  await expect(
    sheet.getByText(
      "Assignment uses each pub’s nearest station’s TfL fare zone. A figure appears after 10 priced pubs.",
    ),
  ).toBeVisible();
});

test("390px Tonight Arc controls show selection and unavailable reason without colour", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  const arc = page.getByRole("group", { name: "Tonight arc venue types" });
  const pints = arc.getByRole("button", { name: "Pints", exact: true });
  const bars = arc.getByRole("button", { name: "Bars", exact: true });
  const clubs = arc.getByRole("button", {
    name: "Clubs are not mapped yet",
  });

  await expect(pints).toContainText("✓");
  await bars.click();
  await expect(bars).toHaveAttribute("aria-pressed", "false");
  await expect(bars).not.toContainText("✓");
  await expect(pints).toContainText("✓");
  await expect(clubs).toBeDisabled();
  await expect(clubs).toContainText("are not mapped yet");
});

test("390px drink glyphs keep the requested 22px box", async ({ page }) => {
  test.setTimeout(90_000);
  const sheet = await openFilters(page);
  const shapeGroup = sheet.getByRole("group", { name: "Filter by drink shape" });

  const capturePath = process.env.DRINK_CHIP_CAPTURE_PATH;
  if (capturePath) {
    await page.screenshot({ path: capturePath, fullPage: true });
  }

  const measurements = await shapeGroup.locator("svg").evaluateAll((glyphs) =>
    glyphs.map((glyph) => {
      const box = glyph.getBoundingClientRect();
      const marks = glyph.querySelectorAll(
        "path, line, rect, circle, ellipse, polyline, polygon",
      );
      return {
        label:
          glyph.closest("button")?.getAttribute("aria-label")?.replace(" (selected)", "") ??
          "",
        width: box.width,
        height: box.height,
        viewBox: glyph.getAttribute("viewBox"),
        strokeWidths: [...new Set(
          [...marks].map((mark) => getComputedStyle(mark).strokeWidth),
        )],
      };
    }),
  );

  console.log(`drink glyph measurements: ${JSON.stringify(measurements)}`);
  expect(measurements.map(({ label, width, height, viewBox }) => ({
    label,
    width,
    height,
    viewBox,
  }))).toEqual(
    CHIP_LABELS.map((label) => ({
      label,
      width: 22,
      height: 22,
      viewBox: "0 0 32 32",
    })),
  );
});
