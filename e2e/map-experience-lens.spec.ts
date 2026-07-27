import { expect, test, type Page } from "@playwright/test";

const VIEWPORT = { width: 390, height: 844 };

test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("no-alcohol and food views own the 390px map without pint controls", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  const filtersButton = page.getByRole("button", { name: /^Filters/ });
  await expect(filtersButton).toBeVisible();
  await filtersButton.click();

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  await expect(sheet).toBeVisible();
  const all = sheet.getByRole("button", { name: "All", exact: true }).first();
  const noAlcohol = sheet.getByRole("button", {
    name: "No alcohol",
    exact: true,
  });
  const food = sheet.getByRole("button", { name: "Food", exact: true });
  for (const control of [all, noAlcohol, food]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 390) + (box?.width ?? 1)).toBeLessThanOrEqual(390);
  }

  const indexResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/api/price-submit?lens=no-alcohol") &&
      candidate.status() === 200,
  );
  await noAlcohol.click();
  await indexResponse;
  await expect(noAlcohol).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("status")).toContainText(
    /soft-drink or alcohol-free prices|no-alcohol prices/i,
  );
  await expect(
    sheet.getByRole("button", { name: "Beer", exact: true }),
  ).toHaveCount(0);
  await expect(sheet.getByText("Maximum pint price")).toHaveCount(0);
  await expect(filtersButton).toHaveAttribute(
    "aria-label",
    "Filters: no-alcohol view active",
  );

  await food.click();
  await expect(food).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("status")).toContainText(
    /sourced menu price|Food venues shown/i,
  );
  await expect(
    page.getByRole("button", { name: "Pints", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Bars", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("group", { name: "Tonight arc venue types" })
      .getByRole("button", { name: "Food", exact: true }),
  ).toBeVisible();
  await expect(filtersButton).toHaveAttribute(
    "aria-label",
    "Filters: food view active",
  );

  expect(errors).toEqual([]);
});
