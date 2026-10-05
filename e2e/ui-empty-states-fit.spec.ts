import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.describe("UI empty states and layout fit", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
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
    // The active-plan pill mounts after Create and lifts it, so sample the
    // float stack only once the pill is in it and the body reserves Create's
    // lifted top edge.
    const showPlan = page.getByRole("button", { name: "Show tonight's plan" });
    await expect(showPlan).toBeVisible();
    const createBox = (await create.boundingBox())!;
    const padding = () => page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.body).paddingBottom),
    );
    await expect.poll(padding).toBeCloseTo(844 - createBox.y, 0);
    const withCreate = await padding();
    await showPlan.click();
    const dialog = page.getByRole("dialog", { name: "Tonight's plan" });
    await expect(dialog).toBeVisible();
    await expect(create).toBeHidden();
    const barBox = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
    // The panel's card can mount a frame after Create hides, and the lane is
    // released only once it has.
    await expect.poll(padding).toBeLessThanOrEqual(withCreate - createBox.height);
    expect(await padding()).toBeGreaterThanOrEqual(barBox.height);
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
