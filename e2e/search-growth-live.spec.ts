import { isNonPublicVenueName } from "@/lib/venueKindFilters";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// Oracle: a clipboard fallback copies an invitation. It does not send one.
// The real browser, plan routes and clipboard run locally. Only the external
// share and analytics boundaries are controlled to prevent delivery.
for (const consent of ["granted", "denied"] as const) {
  test(`usual crew clipboard fallback records a copy with consent ${consent}`, async ({ page, context }, info) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript((choice) => {
      localStorage.setItem("pubmaxx:analytics-consent:v1", choice);
      localStorage.setItem("pubmax-last-crew-v1", JSON.stringify({
        names: ["Test Ada", "Test Ravi"], savedAt: new Date().toISOString(), sourcePlanId: "previous-disposable-plan",
      }));
      localStorage.setItem("pubmax-theme", "light");
      localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      window.open = () => null;
    }, consent);
    const events: Array<Record<string, unknown>> = [];
    await page.route("**/ingest/**", (route) => route.fulfill({ status: 200, body: "{}" }));
    await page.route("**/api/events", async (route) => {
      events.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill({ status: 200, body: "{}" });
    });
    const venues = (await (await page.request.get("/data/venues_slim.json")).json()).rows.filter((venue: { name: string }) => !isNonPublicVenueName(venue.name)).slice(0, 3);
    const created = await page.request.post("/api/plans", {
      headers: { "idempotency-key": randomUUID() },
      data: {
        title: "Disposable search growth night", creatorName: "Test Host",
        startTime: new Date(Date.now() + 3 * 3600_000).toISOString(),
        stops: venues.map((venue: { id: string; name: string }) => ({ venueId: venue.id, venueName: venue.name })),
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const id = (await created.json()).plan.plan.id;
    await page.goto(`/plan/${id}`);
    const invite = page.getByRole("button", { name: "Invite the usual lot", exact: true });
    await expect(invite).toBeVisible();
    await expect(async () => {
      await invite.click();
      await expect(page.locator(".lastCrewInvite__status")).toHaveText("Invite copied. Paste it to the usual lot.", { timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("Test Ada, Test Ravi");
    expect(copied).toMatch(/\/invite\/[a-f0-9]{32}/);
    if (consent === "granted") {
      await expect.poll(() => events.map((event) => event.name)).toContain("plan_invite_link_copied");
      const copy = events.find((event) => event.name === "plan_invite_link_copied")!;
      expect(copy.analyticsConsent).toBe(true);
      expect(copy.props).toEqual({});
      expect(events.map((event) => event.name)).not.toContain("plan_invite_sent");
      expect(JSON.stringify(events)).not.toMatch(/Test Ada|Test Ravi|[a-f0-9]{32}/);
    } else {
      expect(events).toEqual([]);
    }
    await page.locator(".lastCrewInvite").screenshot({ path: info.outputPath(`crew-copy-${consent}.png`) });
    await writeFile(info.outputPath("copy-output.json"), JSON.stringify({ consent, copied, events }, null, 2));
  });
}

test("Victoria and Victorian Soho open their advertised map journeys", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await installDeterministicMapBasemap(page);
  await page.goto("/routes/victorian-soho");
  await page.getByRole("link", { name: "Plan the Victorian Soho crawl on the map" }).click();
  await expect(page).toHaveURL(/\/map\?mode=build&pubs=/);
  await expect(page.locator(".mapCanvasWrap")).toHaveAttribute("data-route-stops", "5", { timeout: 60_000 });
  await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 60_000 });
  await page.screenshot({ path: info.outputPath("soho-map-arrival.png") });
  await page.goto("/area/victoria");
  await page.getByRole("link", { name: "Open Victoria on the map" }).click();
  await expect(page).toHaveURL(/\/map\?area=victoria/);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible();
  await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 60_000 });
  await page.screenshot({ path: info.outputPath("victoria-map-arrival.png") });
});

for (const width of [390, 1440]) {
  test(`public discovery renders dated prices and working crawl links at ${width}px`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("pubmax-theme", "light"));
    await page.goto("/");
    await expect(page.getByTestId("landing-hunt-card")).toContainText("The cheapest pint we found across UK cities");
    await expect(page.getByTestId("landing-hunt-card")).toContainText("Current price may differ.");
    await page.screenshot({ path: info.outputPath(`home-${width}.png`), fullPage: true });
    const cityList = page.locator("#cheapest-pint-by-city");
    await expect(cityList).toContainText("Current prices may differ.");
    await cityList.screenshot({ path: info.outputPath(`cities-${width}.png`) });
    await page.getByRole("link", { name: "London pub crawl routes", exact: true }).click();
    await expect(page).toHaveURL(/\/crawls$/);
    await expect(page.locator(".curatedFeaturedCard")).toContainText("straight-line estimate");
    await page.screenshot({ path: info.outputPath(`crawls-${width}.png`), fullPage: true });
    await page.goto("/routes/victorian-soho");
    await expect(page.getByRole("link", { name: "Plan the Victorian Soho crawl on the map" })).toHaveAttribute("href", /mode=build&pubs=venue-/);
    await page.getByRole("button", { name: "Print it again" }).scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".pintLine__label")).toHaveCount(5);
    await page.screenshot({ path: info.outputPath(`soho-${width}.png`), fullPage: true });
    await page.goto("/area/victoria");
    await expect(page.locator(".drinkBrandDirectory__from")).toContainText(/Source read \d{1,2} \w+ \d{4}/);
    await page.screenshot({ path: info.outputPath(`victoria-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}
