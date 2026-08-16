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

// Three ordinary links behind a disclosure, so they are found as links.
function createRow(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true });
}

async function openCreateMenu(page: Page) {
  const create = page.getByTestId("create-fab");
  await expect(create).toBeVisible();
  // A plain click on purpose: the actionability and occlusion checks ARE the
  // proof that the control and its sheet are clear of the tab bar at every
  // phone width. A forced click would pass through whatever covered them.
  await create.click();
  await expect(createRow(page, "Post a moment")).toBeVisible();
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
      await createRow(page, "Post a moment").click();
      await page.waitForURL(/\/moment\?returnTo=/);

      await page.goto("/out");
      await openCreateMenu(page);
      await createRow(page, "Log a price").click();
      await page.waitForURL(/\/map\?log=1/, { timeout: 45_000 });

      await page.goto("/out");
      await openCreateMenu(page);
      await createRow(page, "Start a plan").click();
      await page.waitForURL(/\/plan$/);
      // The action is mounted in the root layout, so a client-side navigation
      // leaves it mounted: a sheet nobody closed stays painted over wherever it
      // sent you.
      await expect(createRow(page, "Start a plan")).toHaveCount(0);
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
