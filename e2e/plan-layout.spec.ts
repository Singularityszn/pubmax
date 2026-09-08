import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";

const VIEWPORTS = [
  { width: 320, height: 568, theme: "dark" },
  { width: 390, height: 844, theme: "light" },
  { width: 390, height: 844, theme: "dark" },
  { width: 430, height: 932, theme: "dark" },
  { width: 1280, height: 900, theme: "light" },
] as const;

async function setScreen(page: Page, screen: (typeof VIEWPORTS)[number]) {
  await page.setViewportSize({ width: screen.width, height: screen.height });
  await page.evaluate((theme) => document.documentElement.dataset.theme = theme, screen.theme);
}

test.use({ reducedMotion: "reduce", serviceWorkers: "block" });
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("the lock explains its current refusal and phone controls show their values", async ({ page }, testInfo) => {
  await page.route("**/api/plans/generate", (route) => route.fulfill({ json: {
    stops: [1, 2, 3].map((i) => ({ venueId: `layout-${i}`, venueName: `Layout pub ${i}` })),
    inferredContext: {
      nightArea: "clapham", daypart: "evening", partyType: "friends", groupSize: 4,
      stopCount: 3, budget: "standard", budgetLimitPence: 5000, zeroProof: false,
      wetherspoonsPreferred: false, atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [],
    },
  } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/plan");
  const stopCount = page.getByRole("group", { name: "Number of pub stops" });
  const fourStops = stopCount.getByRole("button", { name: "4", exact: true });
  // Retry only a local selection until React handles it, never a generation.
  await expect(async () => {
    await fourStops.click();
    await expect(fourStops).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  const threeStops = stopCount.getByRole("button", { name: "3", exact: true });
  await threeStops.click();
  await expect(threeStops).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  await describeFirstQuery(page).fill("Clapham with friends");
  const [generated] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/plans/generate", { timeout: 1000 }),
    describeFirstSubmit(page).click(),
  ]);
  expect(generated.status()).toBe(200);
  await expect(page.locator("#plan-context-budget")).toBeVisible({ timeout: 1000 });

  const lock = page.getByRole("button", { name: "Lock it in", exact: true });
  const reason = page.locator("#plan-lock-reason");
  await expect(lock).toBeDisabled();
  await expect(reason).toHaveText("Add your name.");
  await expect(lock).toHaveAccessibleDescription("Add your name.");
  await lock.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lock-missing-name-390.png") });
  await page.getByLabel("Your name").fill("Karan");
  await expect(lock).toBeEnabled();
  await expect(reason).toBeEmpty();

  await page.locator("#plan-context-time").selectOption("after_work");
  await page.locator("#plan-context-zero-proof").selectOption("zero-proof");
  await page.locator("#plan-context-budget-limit").fill("500");
  await expect(lock).toBeDisabled();
  await expect(reason).toHaveText("Refresh the route before locking it in.");

  for (const screen of VIEWPORTS) {
    await setScreen(page, screen);
    await page.locator("#plan-context-budget").scrollIntoViewIfNeeded();
    const controls = await page.locator(".planComposer__context").evaluate((fieldset) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      return Array.from(fieldset.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select"), (control) => {
        const style = getComputedStyle(control);
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const select = control instanceof HTMLSelectElement;
        const value = select ? control.selectedOptions[0].text : control.value;
        const bounds = control.getBoundingClientRect();
        return {
          id: control.id,
          available: bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - (select ? 20 : 16),
          needed: ctx.measureText(value).width,
          right: bounds.right,
          left: bounds.left,
        };
      });
    });
    for (const control of controls) {
      expect(control.available, `${screen.width}: ${control.id} shows its full value`).toBeGreaterThanOrEqual(control.needed);
      expect(control.left).toBeGreaterThanOrEqual(0);
      expect(control.right).toBeLessThanOrEqual(screen.width);
    }
    await page.screenshot({ path: testInfo.outputPath(`controls-${screen.width}-${screen.theme}.png`) });
    await lock.scrollIntoViewIfNeeded();
    await expect(reason).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`lock-${screen.width}-${screen.theme}.png`) });
  }
});

test("Night actions follow the stop and the route rail ends before collaboration", async ({ page, context }, testInfo) => {
  const venues = (await (await context.request.get("/data/venues_slim.json")).json() as {
    rows: Array<{ id: string; name: string }>;
  }).rows.slice(0, 3);
  const created = await context.request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Plan layout fixture", creatorName: "Karan",
      startTime: new Date(Date.now() + 30 * 60_000).toISOString(),
      stops: venues.map((venue) => ({ venueId: venue.id, venueName: venue.name })),
    },
  });
  expect(created.ok()).toBe(true);
  const planId: string = (await created.json()).plan.plan.id;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/plan/${planId}`);
  await expect(page.locator(".nightCrawl__hero")).toBeVisible();

  for (const screen of VIEWPORTS.filter((screen) => screen.width < 760)) {
    await setScreen(page, screen);
    const spacer = await page.locator(".nightCrawl__spacer").boundingBox();
    expect(spacer!.height).toBeLessThanOrEqual(24);
    for (const selector of [".nightCrawl__arrive", ".nightCrawl__skip"]) {
      const action = page.locator(selector);
      await action.scrollIntoViewIfNeeded();
      expect(await action.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit === element || (hit !== null && element.contains(hit));
      })).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`night-${screen.width}-${screen.theme}.png`) });
  }

  await page.getByRole("button", { name: "View full plan" }).click();
  const route = page.locator(".planSummary__stops");
  await expect(route).toBeVisible();
  for (const screen of VIEWPORTS) {
    await setScreen(page, screen);
    await route.scrollIntoViewIfNeeded();
    await expect(page.locator(".planSummary__rail")).toHaveCount(0);
    const rail = await route.evaluate((list) => {
      const rows = [...list.children];
      return rows.map((row) => {
        const style = getComputedStyle(row, "::before");
        const bounds = row.getBoundingClientRect();
        const marker = row.querySelector(".planSummary__marker")!.getBoundingClientRect();
        return {
          painted: style.content === '""',
          top: bounds.top + parseFloat(style.top),
          bottom: bounds.bottom - parseFloat(style.bottom),
          x: bounds.left + parseFloat(style.left) + parseFloat(style.width) / 2,
          markerX: marker.left + marker.width / 2,
          markerY: marker.top + marker.height / 2,
        };
      });
    });
    expect(rail[0].painted).toBe(true);
    expect(rail[0].top).toBeCloseTo(rail[0].markerY, 0);
    expect(rail.at(-1)!.bottom).toBeCloseTo(rail.at(-1)!.markerY, 0);
    for (const segment of rail) expect(segment.x).toBeCloseTo(segment.markerX, 0);
    for (let i = 1; i < rail.length; i++) expect(rail[i - 1].bottom).toBeCloseTo(rail[i].top, 0);
    const collaboration = await page.locator(".planCollab").boundingBox();
    expect(rail.at(-1)!.bottom).toBeLessThan(collaboration!.y);
    await page.screenshot({ path: testInfo.outputPath(`route-${screen.width}-${screen.theme}.png`) });
    await page.locator(".planCollab").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`collaboration-${screen.width}-${screen.theme}.png`) });
  }
});
