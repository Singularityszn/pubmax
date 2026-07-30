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
