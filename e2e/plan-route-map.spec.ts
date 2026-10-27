import { expect, test, type Page } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";
import { UI_UX_CHROMIUM_ARGS } from "../scripts/lib/uiUxBattleTestBrowser.mjs";

test.use({ serviceWorkers: "block", launchOptions: { args: [...UI_UX_CHROMIUM_ARGS] } });

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
  const when = new Date(Date.now() + 6 * 60 * 60 * 1000);
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

  test("keyboard route save returns focus after the edit control is enabled", async ({ page }) => {
    await openHydratedPlanComposer(page);
    await describeFirstQuery(page).fill("Quiet in Clapham for 4, not pricey");
    await describeFirstSubmit(page).click();
    await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
    await page.getByLabel("Your name").fill("Keyboard route tester");
    await page.getByLabel("First pint").fill(futureLondonFirstPint());
    await page.getByRole("button", { name: "Regenerate route", exact: true }).click();
    await page.getByRole("button", { name: "Lock it in", exact: true }).click();
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}$/);

    const walkingLink = page.getByRole("link", { name: "See the walking route", exact: true });
    const originalHref = await walkingLink.getAttribute("href");
    const edit = page.getByRole("button", { name: "Edit route", exact: true });
    await edit.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Editing", exact: true })).toBeEnabled();
    const close = page.getByRole("button", { name: "Close editor", exact: true });
    await close.focus();
    await page.keyboard.press("Enter");
    await expect(edit).toBeFocused();

    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: /^Swap stop 1,/ }).click();
    const mapLink = page.getByRole("navigation", { name: "Site navigation" })
      .getByRole("link", { name: "Map", exact: true });
    await expect(mapLink).toHaveAttribute("href", originalHref!);

    let releaseResponse = () => {};
    let markResponseReady = () => {};
    const heldResponse = new Promise<void>((resolve) => { releaseResponse = resolve; });
    const responseReady = new Promise<void>((resolve) => { markResponseReady = resolve; });
    const planId = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.route(`**/api/plans/${planId}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const response = await route.fetch();
      markResponseReady();
      await heldResponse;
      await route.fulfill({ response });
    });
    const save = page.getByRole("button", { name: "Save route changes", exact: true });
    await save.focus();
    await page.keyboard.press("Enter");
    try {
      await responseReady;
      await expect(page.getByRole("button", { name: "Editing", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    } finally {
      releaseResponse();
    }
    await expect(page.getByText("Route saved. The new order is the plan's route now.", { exact: true })).toBeVisible();
    await expect(edit).toBeEnabled();
    await expect(edit).toBeFocused();
    await expect(walkingLink).not.toHaveAttribute("href", originalHref!);
    await expect(mapLink).toHaveAttribute("href", (await walkingLink.getAttribute("href"))!);
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
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}$/);

    const mapPreview = page.locator(".planRouteMiniMap__canvas.maplibreMap");
    await expect(mapPreview).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".planRouteMiniMap__canvas .maplibregl-canvas")).toBeVisible();
    // The credit starts at its (i) button: an open panel covers the last stop.
    // The credit sits beside the link, not inside the aria-hidden canvas.
    await expect(page.locator(".planRouteMiniMap__attrib .maplibregl-ctrl-attrib-button")).toBeVisible();
    await expect(page.locator(".planRouteMiniMap__attrib .maplibregl-ctrl-attrib-inner")).toBeHidden();

    const mapCard = page.locator(".planRouteMiniMap--clickable");
    await expect(mapCard).toBeVisible();
    const routeHref = await mapCard.getAttribute("href");
    expect(routeHref).toBeTruthy();
    const routeStops = new URL(routeHref!, "http://localhost").searchParams.get("pubs")!.split(",");
    const planUrl = page.url();

    const navigation = page.getByRole("navigation", { name: "Site navigation" });
    await expect(navigation.getByRole("link", { name: "Map", exact: true })).toHaveAttribute("href", routeHref!);
    await navigation.getByRole("link", { name: "Map", exact: true }).click();
    await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", String(routeStops.length), { timeout: 60_000 });

    await page.goto(planUrl);
    await expect(mapCard).toBeVisible();

    await mapCard.click();
    await expect(page).toHaveURL(/\/map\?mode=build&pubs=/);
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", String(routeStops.length), { timeout: 60_000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(planUrl);
    const mobileMap = page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Map", exact: true });
    await expect(mobileMap).toHaveAttribute("href", routeHref!);
    await mobileMap.click();
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", String(routeStops.length), { timeout: 60_000 });
  });
});
