import { expect, test } from "@playwright/test";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";

// A plain /map that stays mounted while the reader plans a night must still
// draw the walk the locked plan sends back. Runs in chromium-gl so the map has
// a real WebGL context. data-route-stops is the stop count the map passes to
// its canvas wrapper, not painted geometry; the screenshot is attached for an
// independent visual check of the drawn walk.
test("a reused plain map adopts the saved walking route without reloading", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax-tour-v2-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
  const routeStops = page.locator(".mapCanvasWrap[data-route-stops]");
  await page.goto("/map");
  await expect(routeStops).toHaveAttribute("data-route-stops", "0", { timeout: 60_000 });
  await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole("navigation", { name: "Site navigation" })
    .getByRole("link", { name: "Plan", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await describeFirstQuery(page).fill("Quiet in Clapham for 4, not pricey");
  await describeFirstSubmit(page).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await page.getByLabel("Your name").fill("Route handoff tester");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("First pint").fill(`${tomorrow}T18:00`);
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);
  const walkingLink = page.getByRole("link", { name: "See the walking route", exact: true });
  await expect(walkingLink).toBeVisible();
  const href = await walkingLink.getAttribute("href");
  expect(href).toBeTruthy();
  const ids = new URL(href!, "http://localhost").searchParams.get("pubs")!.split(",");
  expect(ids.length).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Edit route", exact: true }).click();
  await expect(page.getByRole("button", { name: "Editing", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^(?:Discard draft|Close editor)$/ }).click();
  await walkingLink.click();
  await expect(page).toHaveURL(new URL(href!, page.url()).href);
  await expect(routeStops).toHaveAttribute("data-route-stops", String(ids.length), { timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^(?:Recenter route|Show whole walk)$/ })).toBeVisible();
  await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 60_000 });
  // The map's own URL sync keeps the ordered stops it adopted.
  await expect.poll(() => new URL(page.url()).searchParams.get("pubs")).toBe(ids.join(","));
  await expect(routeStops).toHaveAttribute("data-route-stops", String(ids.length));
  await testInfo.attach("reused-map-walking-route", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
