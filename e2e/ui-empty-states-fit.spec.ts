import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.describe("UI empty states and layout fit", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.route("**/_vercel/insights/script.js", (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
    );
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-theme", "light");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
    });
  });

  test("signed-out Social Posts rail is worded at 390", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/social");
    await expect(page.getByRole("link", { name: "Posts", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("No posts to read yet.")).toBeVisible();
    await expect(page.locator(".socialRailEmpty")).toBeVisible();
  });

  test("night crawl actions sit below the stop name without a dead band", async ({
    page,
    request,
  }) => {
    const startTime = new Date().toISOString();
    const venueResponse = await request.get("/data/venues_slim.json");
    const venues = (
      (await venueResponse.json()) as { rows: Array<{ id: string; name: string }> }
    ).rows.slice(0, 3);
    const createdResponse = await request.post("/api/plans", {
      headers: { "idempotency-key": randomUUID() },
      data: {
        title: "Layout crawl",
        creatorName: "Fit host",
        startTime,
        stops: venues.map((venue) => ({ venueId: venue.id, venueName: venue.name })),
      },
    });
    expect(createdResponse.ok()).toBe(true);
    const created = (await createdResponse.json()) as {
      plan: { plan: { id: string; startTime: string } };
      memberToken: string;
    };
    const planId = created.plan.plan.id;
    const planStart = created.plan.plan.startTime;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(({ id, start, token }) => {
      localStorage.setItem(
        "pubmax_active_plan",
        JSON.stringify({
          version: 1,
          id,
          startTime: start,
          stopIndex: 0,
          role: "host",
          endingPreview: null,
          palContext: null,
        }),
      );
      sessionStorage.setItem(`pubmax-plan-member:${id}`, token);
    }, { id: planId, start: planStart, token: created.memberToken });
    await page.goto(`/plan/${planId}`);
    const nightMode = page.getByRole("dialog", { name: "Night mode" });
    await expect(nightMode).toBeVisible({ timeout: 15_000 });
    const hero = nightMode.locator(".nightCrawl__hero");
    await expect(nightMode.locator(".nightCrawl__heroName")).toBeVisible({ timeout: 15_000 });
    const gap = await hero.evaluate((node) => {
      const name = node.querySelector(".nightCrawl__heroName");
      const actions = node.querySelector(".nightCrawl__actions");
      if (!name || !actions) return null;
      const nameBox = name.getBoundingClientRect();
      const actionsBox = actions.getBoundingClientRect();
      return actionsBox.top - nameBox.bottom;
    });
    expect(gap).not.toBeNull();
    expect(gap!).toBeLessThan(120);
  });

  test("On tonight panel resolves route or fails closed", async ({ page, request }) => {
    const startTime = new Date().toISOString();
    const venueResponse = await request.get("/data/venues_slim.json");
    const venues = (
      (await venueResponse.json()) as { rows: Array<{ id: string; name: string }> }
    ).rows.slice(0, 2);
    const createdResponse = await request.post("/api/plans", {
      headers: { "idempotency-key": randomUUID() },
      data: {
        title: "Panel crawl",
        creatorName: "Panel host",
        startTime,
        stops: venues.map((venue) => ({ venueId: venue.id, venueName: venue.name })),
      },
    });
    expect(createdResponse.ok()).toBe(true);
    const created = (await createdResponse.json()) as {
      plan: { plan: { id: string; startTime: string } };
      memberToken: string;
    };
    const planId = created.plan.plan.id;
    const planStart = created.plan.plan.startTime;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(({ id, start, token }) => {
      localStorage.setItem(
        "pubmax_active_plan",
        JSON.stringify({
          version: 1,
          id,
          startTime: start,
          stopIndex: 0,
          role: "host",
          endingPreview: null,
          palContext: null,
        }),
      );
      sessionStorage.setItem(`pubmax-plan-member:${id}`, token);
    }, { id: planId, start: planStart, token: created.memberToken });
    await page.goto("/tonight");
    const create = page.getByRole("button", { name: "Create", exact: true });
    await expect(create).toBeVisible();
    await expect(page.getByRole("button", { name: "Show tonight's plan" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const fab = document.querySelector(".createFab")!.getBoundingClientRect();
      const padding = Number.parseFloat(getComputedStyle(document.body).paddingBottom);
      return Math.abs(padding - (innerHeight - fab.top));
    })).toBeLessThan(0.5);
    const createBox = (await create.boundingBox())!;
    const padding = () => page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.body).paddingBottom),
    );
    const withCreate = await padding();
    await page.getByRole("button", { name: "Show tonight's plan" }).click();
    const dialog = page.getByRole("dialog", { name: "Tonight's plan" });
    await expect(dialog).toBeVisible();
    await expect(create).toBeHidden();
    const barBox = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
    await expect.poll(padding).toBeLessThanOrEqual(withCreate - createBox.height);
    const withoutCreate = await padding();
    expect(withoutCreate).toBeGreaterThanOrEqual(barBox.height);
    expect(withCreate - withoutCreate).toBeGreaterThanOrEqual(createBox.height);
    await expect(
      dialog.getByText("Loading tonight's route…"),
    ).toBeHidden({ timeout: 15_000 });
    const hasStop = await dialog.locator(".nightCard__now").count();
    const hasEmpty = await dialog.getByText("Tonight's route isn't open here yet.").count();
    expect(hasStop + hasEmpty).toBeGreaterThan(0);
    await dialog.getByRole("button", { name: "Hide tonight's plan" }).click();
    await expect(dialog).toBeHidden();
    await expect(create).toBeVisible();
    await expect.poll(padding).toBe(withCreate);
  });
});
