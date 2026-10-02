import { expect, test, type Page } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";

async function openHydratedPlanComposer(page: Page): Promise<void> {
  await page.goto("/plan");
  const stopCount = page
    .getByRole("group", { name: "Number of pub stops" })
    .getByRole("button", { name: "4", exact: true });
  await expect(async () => {
    await stopCount.click();
    await expect(stopCount).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

function futureLondonFirstPint(): string {
  const when = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(when);
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}T${lookup("hour")}:${lookup("minute")}`;
}

test.describe("locked plan route map", () => {
  test.beforeEach(async ({ page }) => {
    await installAuthDoubles(page);
    await seedSignedIn(page);
    // The identity nudge (lib/identityNudge.ts) fires after the plan locks and
    // lays a backdrop over the route card this test taps. It has its own
    // coverage; pre-dismissing it is what a returning visitor already carries.
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    });
  });

  test("shows a real map preview and deep-links to the crawl on the main map", async ({
    page,
  }) => {
    await openHydratedPlanComposer(page);
    await describeFirstQuery(page).fill("Quiet in Clapham for 4, not pricey");
    await describeFirstSubmit(page).click();
    await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
    await page.getByLabel("Your name").fill("Route map tester");
    await page.getByLabel("First pint").fill(futureLondonFirstPint());
    await page.getByRole("button", { name: "Regenerate route" }).click();
    await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
    await page.getByRole("button", { name: "Lock it in" }).click();
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}/);

    const mapPreview = page.locator(".planRouteMiniMap__canvas.maplibreMap");
    await expect(mapPreview).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".planRouteMiniMap__canvas .maplibregl-canvas")).toBeVisible();
    // Attribution remains a separate control above the full-card route link.
    const attributionButton = page.locator(".planRouteMiniMap__attrib .maplibregl-ctrl-attrib-button");
    const attributionCredit = page.locator(".planRouteMiniMap__attrib .maplibregl-ctrl-attrib-inner");
    await expect(attributionButton).toBeVisible();
    await expect(attributionCredit).toBeHidden();
    await attributionButton.click();
    await expect(attributionCredit).toBeVisible();
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}/);
    await attributionButton.click();
    await expect(attributionCredit).toBeHidden();

    const routeLink = page.locator(".planRouteMiniMap__routeLink");
    await expect(routeLink).toHaveAttribute("href", /\/map\?mode=build&pubs=/);
    await routeLink.click();
    await expect(page).toHaveURL(/\/map\?mode=build&pubs=/);
    await expect(page.locator(".mapCanvasWrap, .mapCanvasSkeleton")).toBeVisible();

    await page.goBack();
    const returnedRouteLink = page.locator(".planRouteMiniMap__routeLink");
    await expect(returnedRouteLink).toBeVisible({ timeout: 60_000 });
    await returnedRouteLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/map\?mode=build&pubs=/);
  });
});
