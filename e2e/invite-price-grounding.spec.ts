import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

for (const width of [390, 1440]) {
  test(`invite pint prices keep their unit and source at ${width}px`, async ({ page, request }) => {
    const created = await request.post("/api/plans", { headers: { "idempotency-key": randomUUID() }, data: {
      title: "Local invite price proof", creatorName: "Local host",
      startTime: new Date(Date.now() + 3 * 3600_000).toISOString(),
      stops: [{ venueId: "venue-e1srzr", venueName: "Shakespeares Head (Soho)" }, { venueId: "venue-15i2wst", venueName: "Golden Lion (Soho)" }],
    } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).plan.plan.id;
    const state = await (await request.get(`/api/plans/${id}`)).json();
    expect(state.inviteToken).toBeTruthy();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/invite/${state.inviteToken}`);
    await expect(page.locator(".invite__spend")).toHaveText("£6.25–£6.40 per pint");
    const stop = page.locator(".invite__stop").filter({ hasText: "Shakespeares Head" });
    await expect(stop).toContainText("Listed by Pint Prices, collected 2 October 2026.");
    await expect(stop.getByRole("link", { name: "Pint Prices", exact: true })).toHaveAttribute("href", /^https:\/\//);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("a guest who joined on the plan can return there from an RSVP ownership refusal", async ({ page, request }) => {
  test.setTimeout(60_000);
  const created = await request.post("/api/plans", { headers: { "idempotency-key": randomUUID() }, data: {
    title: "Local existing crew proof", creatorName: "Local host",
    startTime: new Date(Date.now() + 3 * 3600_000).toISOString(),
    stops: [{ venueId: "venue-e1srzr", venueName: "Shakespeares Head (Soho)" }],
  } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).plan.plan.id;
  const { inviteToken } = await (await request.get(`/api/plans/${id}`)).json();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/plan/${id}#invite=${inviteToken}`);
  await page.getByRole("textbox", { name: "Your name is enough.", exact: true }).fill("Local guest");
  await page.getByRole("button", { name: "I’m in", exact: true }).click();
  await expect(page.locator(".planCrew")).toContainText("Local guest");
  await page.goto(`/invite/${inviteToken}`);
  await page.getByRole("textbox", { name: "Your name", exact: true }).fill("Local guest");
  await page.getByRole("button", { name: "Maybe", exact: true }).click();
  await expect(page.getByRole("button", { name: "Maybe", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "RSVP", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Change your crew status on the plan." })).toBeVisible();
  const recovery = page.getByRole("link", { name: "Open the plan", exact: true });
  await expect(recovery).toHaveAttribute("href", `/plan/${id}`);
  await recovery.click();
  await expect(page.getByRole("group", { name: "Update your status", exact: true })).toBeVisible();
});
