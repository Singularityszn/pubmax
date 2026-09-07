import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });

async function prepareNight(page: Page, request: APIRequestContext) {
  const response = await request.get("/data/venues_slim.json");
  const venues = (await response.json()).rows.slice(0, 3) as { id: string; name: string }[];
  const startTime = new Date().toISOString();
  const created = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Phone state recovery", creatorName: "Phone host", startTime,
      stops: venues.map((venue) => ({ venueId: venue.id, venueName: venue.name })),
    },
  });
  expect(created.ok()).toBe(true);
  const body = await created.json();
  const id = body.plan.plan.id as string;
  await page.addInitScript(({ id, startTime, token }) => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
    localStorage.setItem("pubmax_active_plan", JSON.stringify({ id, startTime, stopIndex: 0 }));
    sessionStorage.setItem(`pubmax-plan-member:${id}`, token);
  }, { id, startTime, token: body.memberToken });
  return { id, firstStop: venues[0].name, memberToken: body.memberToken as string };
}

test("an in-flight anonymous route cannot replace the restored host route or Night card", async ({ page, request }) => {
  const { id, firstStop } = await prepareNight(page, request);
  let releaseSession!: () => void;
  let releasePreview!: () => void;
  const sessionGate = new Promise<void>((resolve) => { releaseSession = resolve; });
  const previewGate = new Promise<void>((resolve) => { releasePreview = resolve; });
  let previewHeld = false;
  let reads = 0;
  await page.route(`**/api/plans/${id}/session`, async (route) => {
    if (route.request().method() === "POST") await sessionGate;
    await route.continue();
  });
  await page.route(`**/api/plans/${id}`, async (route) => {
    reads += 1;
    if (reads === 1) {
      const response = await route.fetch();
      expect((await response.json()).visibility).toBe("preview");
      previewHeld = true;
      await previewGate;
      await route.fulfill({ response });
    } else {
      await route.continue();
    }
  });
  await page.goto(`/plan/${id}`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => previewHeld).toBe(true);
  const restored = page.waitForResponse((response) => response.url().endsWith(`/api/plans/${id}/session`) && response.request().method() === "POST");
  releaseSession();
  expect((await restored).ok()).toBe(true);
  // Keep the anonymous answer pending until the cookie and capability event land.
  await expect.poll(async () => (await page.context().cookies()).some((cookie) => cookie.path === `/api/plans/${id}`)).toBe(true);
  await page.getByRole("button", { name: "View full plan" }).click();
  await page.getByRole("button", { name: "Show tonight's plan" }).click();
  const sheet = page.getByRole("dialog", { name: "Tonight's plan" });
  await expect(sheet).toBeVisible();
  releasePreview();
  await expect.soft(sheet.locator(".nightCard__now")).toHaveText(firstStop);
  await page.keyboard.press("Escape");
  await expect.soft(page.locator(".planSummary")).toContainText(firstStop);
});

test("Night offers Retry after a failed read and withdraws compose only while expanded", async ({ page, request }, testInfo) => {
  const { id, firstStop, memberToken } = await prepareNight(page, request);
  // Establish the real path-scoped cookie in the browser context.
  const session = await page.request.post(`/api/plans/${id}/session`, {
    headers: { authorization: `Bearer ${memberToken}` },
  });
  expect(session.ok()).toBe(true);
  let failRead = true;
  await page.route(`**/api/plans/${id}`, async (route) => {
    if (failRead) await route.fulfill({ status: 503, json: { error: "Temporary read failure" } });
    else await route.continue();
  });
  await page.goto("/tonight");
  const fab = page.locator(".createFab");
  await expect(fab).toBeVisible();
  await page.getByRole("button", { name: "Show tonight's plan" }).click();
  const sheet = page.getByRole("dialog", { name: "Tonight's plan" });
  await expect(sheet).toBeVisible();
  await expect.soft(fab).toBeHidden();
  await expect.soft(fab).toHaveCSS("pointer-events", "none");
  const retry = sheet.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("night-read-unavailable.png") });
  failRead = false;
  await retry.click();
  await expect(sheet.locator(".nightCard__now")).toHaveText(firstStop);
  await expect(retry).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("night-read-recovered.png") });
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(fab).toBeVisible();
  await expect(fab).toHaveCSS("pointer-events", "auto");
});
