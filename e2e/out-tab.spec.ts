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
      // The day chips are LINKS, not radios: each is a destination, so they keep
      // the link role and say where they are with aria-current.
      const when = page.getByRole("navigation", { name: "When" });
      const tonightChip = when.getByRole("link", { name: "Tonight", exact: true });
      await expect(tonightChip).toBeVisible();
      await expect(tonightChip).toHaveAttribute("aria-current", "page");
      // Space activates a focused chip the way Enter does.
      const weekendChip = when.getByRole("link", { name: "Weekend", exact: true });
      await weekendChip.focus();
      await page.keyboard.press(" ");
      await page.waitForURL(/\/out\?day=weekend$/);
      await expect(
        when.getByRole("link", { name: "Weekend", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.goto("/out");

      // Nothing reads the viewer's plans yet, so the section may not say they
      // have none - it says where they will appear and offers the way to one.
      const plans = page.getByRole("region", { name: "Open plans" });
      await expect(plans).toContainText("Open plans arrive here.");
      await expect(plans).not.toContainText(/no open plans/i);
      await expect(plans.getByRole("link", { name: "Start a plan", exact: true })).toHaveAttribute(
        "href",
        "/plan",
      );

      // /out is not a crawlable family yet: it duplicates /tonight's baseline
      // rows, so it ships noindex with no canonical of its own.
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

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

const PLAYHOUSE_EVENT = {
  id: "events-tm-playhouse",
  placeName: "Soho Theatre",
  kind: "event",
  startsAt: "2026-08-16T19:00:00.000Z",
  title: "A Night at the Playhouse",
  source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
  observedAt: "2026-08-16T09:00:00.000Z",
  confidence: "listed",
  sourceId: "1",
};

test("shows event cards when GET /api/out is ready", async ({ page }) => {
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [PLAYHOUSE_EVENT],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 1, status: "ready" }],
      }),
    }),
  );

  await page.goto("/out");
  await expect(page.getByTestId("out-screen")).toBeVisible();
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "A Night at the Playhouse" })).toBeVisible();
  await expect(page.getByText("Open plans arrive here.")).toBeVisible();
});

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
