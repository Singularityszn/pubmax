import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [320, 390, 430] as const;
const SHOTS_DIR = "docs/screenshots/out-l1";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

async function openCreateMenu(page: Page) {
  const create = page.getByTestId("create-fab");
  await expect(create).toBeVisible();
  await create.evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByRole("menuitem", { name: "Post a moment" })).toBeVisible();
}

for (const width of WIDTHS) {
  test.describe(`out tab @${width}`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("shows the Out tab, renders /out, and the create action reaches each row", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto("/out");
      const out = primaryNav(page).getByRole("link", { name: "Out", exact: true });
      await expect(out).toBeVisible();
      await expect(out).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("out-screen")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Out", exact: true })).toBeVisible();
      await expect(page.getByRole("radio", { name: "Tonight", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: /start one/i })).toHaveAttribute("href", "/plan");

      await openCreateMenu(page);
      await page.getByRole("menuitem", { name: "Post a moment" }).click();
      await page.waitForURL(/\/moment\?returnTo=/);

      await page.goto("/out");
      await openCreateMenu(page);
      await page.getByRole("menuitem", { name: "Log a price" }).click({ force: true });
      await page.waitForURL(/\/map\?log=1/, { timeout: 45_000 });

      await page.goto("/out");
      await openCreateMenu(page);
      await page.getByRole("menuitem", { name: "Start a plan" }).click();
      await page.waitForURL(/\/plan$/);
    });
  });
}

test.describe("out tab screenshots @390", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.setTimeout(60_000);

  test("commits light and dark 390 frames", async ({ page }) => {
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/out");
    await expect(page.getByTestId("out-screen")).toBeVisible();
    await page.screenshot({ path: `${SHOTS_DIR}/out-390-light.png`, fullPage: false });

    const theme = page.getByRole("button", { name: /switch to dark theme/i });
    if (await theme.isVisible()) {
      await theme.click();
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.getByTestId("out-screen")).toBeVisible();
    await page.screenshot({ path: `${SHOTS_DIR}/out-390-dark.png`, fullPage: false });
  });
});
