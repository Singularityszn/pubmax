import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Core-loop battle test, 5 Sep 2026: D02 (silent data loss in the route
// editor) and M03 (a triple-clicked Save sent two PATCHes and printed two
// contradictory lines). The editor needs the member projection of
// /api/plans/[id], which a capability ALONE decides after #1519 deleted the
// rollout flag, so this fence belongs in the default project: a data-loss
// guard only a dedicated shard runs is a guard a local `npm run test:e2e`
// never spends. The keyless server holds the plan in memory and the HttpOnly
// member cookie set on create travels with the page and the shared request
// context.

type Stop = { venueId: string; venueName: string };

// Listed venues, so the server's route canonicaliser accepts every write.
const ARNOS: Stop = { venueId: "venue-xjf3n0", venueName: "Arnos Arms" };
const BOHEMIA: Stop = { venueId: "venue-1f5ygjb", venueName: "The Bohemia" };
const ELEPHANT: Stop = { venueId: "venue-3h52h", venueName: "The Elephant Inn" };
const FINCHLEY: Stop = { venueId: "venue-lrz4u2", venueName: "Finchley United Services Club Ltd" };
const GEORGE: Stop = { venueId: "venue-1eycmcw", venueName: "George" };
const HAZINE: Stop = { venueId: "venue-a9nk2t", venueName: "Hazine" };

const STORED = [ARNOS, BOHEMIA, ELEPHANT];

// What the deterministic generator answers for this plan's context: the same
// three pubs, stops 2 and 3 the other way round, each with one backup. Before
// the fix this answer BECAME the draft, so the editor re-sequenced the stored
// route and the next save wrote over a pub the host had already saved.
const GENERATED = {
  stops: [
    { ...ARNOS, alternatives: [FINCHLEY] },
    { ...ELEPHANT, alternatives: [HAZINE] },
    { ...BOHEMIA, alternatives: [GEORGE] },
  ],
  alternatives: [],
};

const PENDING_KEY_PREFIX = "pubmaxx:plan-pending-route:v1:";

async function createPlan(api: APIRequestContext): Promise<{ planId: string; memberToken: string }> {
  const created = await api.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Route editor integrity",
      startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      creatorName: "Host",
      stops: STORED,
    },
  });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as { memberToken: string; plan: { plan: { id: string } } };
  const planId = body.plan.plan.id;
  const ready = await api.patch(`/api/plans/${planId}`, {
    data: {
      memberToken: body.memberToken,
      status: "ready",
      context: {
        nightArea: "clapham",
        daypart: "evening",
        partyType: "friends",
        groupSize: 3,
        budget: "value",
      },
    },
  });
  expect(ready.ok()).toBeTruthy();
  return { planId, memberToken: body.memberToken };
}

async function storedStops(api: APIRequestContext, planId: string): Promise<{ names: string[]; revision: number }> {
  const response = await api.get(`/api/plans/${planId}`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { stops: Array<{ venueName: string; position: number }>; plan: { routeRevision: number } };
  return {
    names: body.stops.slice().sort((a, b) => a.position - b.position).map((stop) => stop.venueName),
    revision: body.plan.routeRevision,
  };
}

async function preparePage(page: Page): Promise<void> {
  await page.route("**/api/plans/generate", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GENERATED) });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

const editorStops = (page: Page) => page.locator(".planSummary__editStops strong");
const routeRegion = (page: Page) => page.getByRole("region", { name: "The route" });
// The editor's own line, apart from the Round starter's and the crew
// panel's live regions and Next's route announcer.
const editorLines = (page: Page) => routeRegion(page).locator(".planSummary__status");
const statusLine = (page: Page) => editorLines(page).and(page.locator("[role='status']"));
const alertLine = (page: Page) => editorLines(page).and(page.locator("[role='alert']"));

async function openEditor(page: Page): Promise<void> {
  const edit = page.getByRole("button", { name: "Edit route" });
  // A tap that lands before React attaches is dropped, so retry the tap
  // itself until the editor answers.
  await expect(async () => {
    await edit.click();
    await expect(page.getByRole("heading", { name: "Route preview" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Edit route" })).toHaveCount(0);
}

async function pendingDraft(page: Page, planId: string): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), `${PENDING_KEY_PREFIX}${planId}`);
}

test("the editor opens on the stored route, a save clears the draft, and a second save never loses a stop", async ({ page }) => {
  const api = page.context().request;
  const { planId } = await createPlan(api);
  await preparePage(page);
  await page.goto(`/plan/${planId}`);
  await expect(routeRegion(page)).toBeVisible();

  // D02: the editor opens on the STORED stops in their stored order, not on
  // the generator's re-sequenced answer.
  await openEditor(page);
  await expect(editorStops(page)).toHaveText(STORED.map((stop) => stop.venueName));

  await page.getByRole("button", { name: `Swap stop 3, currently ${ELEPHANT.venueName}` }).click();
  await expect(editorStops(page)).toHaveText([ARNOS.venueName, BOHEMIA.venueName, GEORGE.venueName]);
  expect(await pendingDraft(page, planId)).not.toBeNull();

  await page.getByRole("button", { name: "Save route changes" }).click();
  await expect(statusLine(page)).toHaveText("Route saved. The new order is the plan's route now.");
  await expect(alertLine(page)).toHaveCount(0);
  expect(await pendingDraft(page, planId)).toBeNull();
  expect((await storedStops(api, planId)).names).toEqual([ARNOS.venueName, BOHEMIA.venueName, GEORGE.venueName]);

  // Reload: the saved stops, no editor, no recovered draft.
  await page.reload();
  await expect(routeRegion(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Route preview" })).toHaveCount(0);
  for (const name of [ARNOS.venueName, BOHEMIA.venueName, GEORGE.venueName]) {
    await expect(routeRegion(page).getByText(name, { exact: true })).toBeVisible();
  }

  // Edit again: the editor shows the SAVED stops, and a second save keeps them.
  await openEditor(page);
  await expect(editorStops(page)).toHaveText([ARNOS.venueName, BOHEMIA.venueName, GEORGE.venueName]);
  // Stop 2's first backup is the generator's own pick for that position,
  // which is no longer in the route once George holds stop 3.
  await page.getByRole("button", { name: `Swap stop 2, currently ${BOHEMIA.venueName}` }).click();
  await expect(editorStops(page)).toHaveText([ARNOS.venueName, ELEPHANT.venueName, GEORGE.venueName]);
  await page.getByRole("button", { name: "Save route changes" }).click();
  await expect(statusLine(page)).toHaveText("Route saved. The new order is the plan's route now.");

  // George, saved a moment ago, survives the second save.
  const final = await storedStops(api, planId);
  expect(final.names).toEqual([ARNOS.venueName, ELEPHANT.venueName, GEORGE.venueName]);
  expect(final.revision).toBe(3);
});

test("a draft older than the stored route never opens the editor and is cleared", async ({ page }) => {
  const api = page.context().request;
  const { planId, memberToken } = await createPlan(api);
  // Another tab moves the route to revision 2.
  const moved = await api.patch(`/api/plans/${planId}`, {
    data: { memberToken, stops: [ARNOS, BOHEMIA, GEORGE], expectedRouteRevision: 1 },
  });
  expect(moved.ok()).toBeTruthy();

  await preparePage(page);
  await page.addInitScript(
    ({ key, draft }) => {
      window.localStorage.setItem(key, draft);
    },
    {
      key: `${PENDING_KEY_PREFIX}${planId}`,
      draft: JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        expectedRouteRevision: 1,
        stops: [ARNOS, HAZINE, ELEPHANT].map((stop, position) => ({ ...stop, position, alternatives: [] })),
        groundingProof: null,
        operationKey: null,
      }),
    },
  );
  await page.goto(`/plan/${planId}`);
  await expect(routeRegion(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit route" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Route preview" })).toHaveCount(0);
  await expect(routeRegion(page).getByText(GEORGE.venueName, { exact: true })).toBeVisible();
  await expect(routeRegion(page).getByText(HAZINE.venueName, { exact: true })).toHaveCount(0);
  await expect.poll(() => pendingDraft(page, planId)).toBeNull();
});

test("a stale save re-seeds the editor from the stored route and prints one line", async ({ page }) => {
  const api = page.context().request;
  const { planId, memberToken } = await createPlan(api);
  await preparePage(page);
  await page.goto(`/plan/${planId}`);
  await expect(routeRegion(page)).toBeVisible();
  await openEditor(page);
  // By index, not by name: this case is about the stale save, so it must
  // reach Save whatever the editor opened on.
  await page.locator(".planSummary__swap").nth(2).click();

  // Another tab saves first.
  const moved = await api.patch(`/api/plans/${planId}`, {
    data: { memberToken, stops: [ARNOS, BOHEMIA, HAZINE], expectedRouteRevision: 1 },
  });
  expect(moved.ok()).toBeTruthy();

  await page.getByRole("button", { name: "Save route changes" }).click();
  await expect(alertLine(page)).toHaveText(
    "This route changed in another tab. Nothing was saved. The latest route is shown below.",
  );
  await expect(statusLine(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Route preview" })).toHaveCount(0);
  await expect(routeRegion(page).getByText(HAZINE.venueName, { exact: true })).toBeVisible();
  await expect(routeRegion(page).getByText(GEORGE.venueName, { exact: true })).toHaveCount(0);
  expect(await pendingDraft(page, planId)).toBeNull();
  expect((await storedStops(api, planId)).names).toEqual([ARNOS.venueName, BOHEMIA.venueName, HAZINE.venueName]);

  // The editor now opens on the route the other tab saved.
  await openEditor(page);
  await expect(editorStops(page)).toHaveText([ARNOS.venueName, BOHEMIA.venueName, HAZINE.venueName]);
});

test("a triple-clicked Save sends one PATCH and leaves one line on screen", async ({ page }) => {
  const api = page.context().request;
  const { planId } = await createPlan(api);
  await preparePage(page);
  const patches: string[] = [];
  await page.route(`**/api/plans/${planId}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    patches.push(route.request().postData() ?? "");
    // Hold the write long enough for the second and third clicks to land
    // while the first is in flight.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fallback();
  });
  await page.goto(`/plan/${planId}`);
  await expect(routeRegion(page)).toBeVisible();
  await openEditor(page);
  await page.locator(".planSummary__swap").nth(2).click();

  const save = page.getByRole("button", { name: "Save route changes" });
  // Three taps inside ONE task: React commits the `saving` flag in a
  // microtask after the event, so a burst of taps that lands before it (a
  // busy phone main thread, or a script) all ran the handler with the flag
  // still false. Playwright's own clickCount dispatches three separate
  // events with a microtask checkpoint between them, which the rendered
  // disabled attribute already survives, so it is not the reproduction.
  await save.evaluate((button) => {
    const control = button as HTMLButtonElement;
    control.click();
    control.click();
    control.click();
  });
  await expect(statusLine(page)).toHaveText("Route saved. The new order is the plan's route now.");
  await expect(alertLine(page)).toHaveCount(0);
  await expect(editorLines(page)).toHaveCount(1);
  expect(patches).toHaveLength(1);
  expect((await storedStops(api, planId)).revision).toBe(2);
});
