import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Core-loop battle test, 5 Sep 2026: M01 and M02. Two readings of one rule.
//
// The plan page server-renders only the privacy-safe preview, and every plan
// surface upgrades itself client-side through the capability-gated
// GET /api/plans/[id]. The upgrade read used to run ONCE, at mount, so a
// capability that arrived any later than that first read never reached the
// route:
//
//   M01 a host opening their own plan on a second device saw the invitee
//       teaser, because the seat claim landed after the read.
//   M02 a fresh guest who tapped "I'm in" saw their crew row appear while the
//       route still said "reveals once you join", until they reloaded.
//
// Both are proved against the member projection, which a capability alone now
// unlocks (#1519), so this rides the default suite.

const REVEAL_BUDGET_MS = 30_000;

/**
 * A returning visitor: no consent bar, no tour, no onboarding, no identity
 * nudge over the page. These contexts are made with browser.newContext(), which
 * inherits none of the project's storageState, so a fresh browser would answer
 * the consent bar over the join control instead of the journey.
 */
const SETTLED_VISITOR = () => {
  window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  window.localStorage.setItem("pubmax-tour-v1-done", "1");
  window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
  window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
};

type SeededPlan = { planId: string; inviteToken: string; venueNames: string[] };

/** Create a real Plan through the API. The request context keeps the host's
 *  HttpOnly member cookie, exactly as the creating tab does. */
async function seedPlan(request: APIRequestContext): Promise<SeededPlan> {
  const venues = ((await (await request.get("/data/venues_slim.json")).json() as {
    rows: Array<{ id: string; name: string }>;
  }).rows).slice(0, 3);
  expect(venues.length).toBe(3);

  const created = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Join reveal spec crawl",
      startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      creatorName: "Karan",
      stops: venues.map((venue) => ({ venueId: venue.id, venueName: venue.name })),
    },
  });
  expect(created.ok()).toBe(true);
  const planId: string = (await created.json()).plan.plan.id;

  const state = await (await request.get(`/api/plans/${planId}`)).json() as {
    inviteToken?: string | null;
  };
  expect(state.inviteToken).toBeTruthy();

  return {
    planId,
    inviteToken: state.inviteToken as string,
    venueNames: venues.map((venue) => venue.name),
  };
}

/** The host's own plan-member cookie, as the seat claim would set it. */
async function hostMemberCookie(request: APIRequestContext, planId: string) {
  const { cookies } = await request.storageState();
  const cookie = cookies.find((row) => row.name === `pubmax_plan_member_${planId}`);
  expect(cookie, "the create response set the host's plan-member cookie").toBeTruthy();
  return cookie!;
}

test("M02: a guest who taps I'm in sees the route without reloading", async ({
  request,
  browser,
}, testInfo) => {
  // A cold production page can take a while to attach, and the join is only
  // real once it has: the budget is the page's, not the assertion's.
  testInfo.setTimeout(120_000);
  const { planId, inviteToken, venueNames } = await seedPlan(request);

  const guest = await browser.newContext();
  const page = await guest.newPage();
  await page.addInitScript(SETTLED_VISITOR);
  await page.goto(`/plan/${planId}#invite=${inviteToken}`);

  // Before joining: the teaser, and not one venue name on the page.
  await expect(page.getByRole("link", { name: "Join the crew to see the route" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(venueNames[0]!);

  // No hydration race to retry around: the join form is client-rendered, and
  // PlanCrew shows "Restoring your private crew session…" until the session read
  // answers, so this field existing IS the proof that React has attached.
  const joinButton = page.getByRole("button", { name: "I’m in" });
  const crewRow = page.getByRole("listitem").filter({ hasText: "Priya" });
  await page.locator("#join-name").fill("Priya");
  // The control is replaced by the presence row the moment the join lands, so a
  // click that has already been dispatched can still sit waiting for an element
  // that is on its way out. The assertion below is what decides the outcome.
  await joinButton.click({ timeout: 5_000 }).catch(() => undefined);
  await expect(crewRow).toBeVisible({ timeout: REVEAL_BUDGET_MS });

  // The whole point: no reload between the join and the route.
  for (const name of venueNames) {
    await expect(page.locator("body")).toContainText(name, { timeout: REVEAL_BUDGET_MS });
  }
  await expect(
    page.getByRole("link", { name: "Join the crew to see the route" }),
  ).toHaveCount(0);

  await guest.close();
});

test("M01: a capability that lands after the first read still reveals the route", async ({
  request,
  browser,
}, testInfo) => {
  testInfo.setTimeout(120_000);
  const { planId, venueNames } = await seedPlan(request);
  const cookie = await hostMemberCookie(request, planId);

  // The real second-device sequence is: the plan read runs before the account
  // session has resolved, so the seat claim has not been spent yet; the claim
  // lands moments later and sets the capability cookie. The keyless e2e server
  // cannot verify a bearer, so PUT and PATCH /session both answer 503 by design
  // (see e2e/plan-capability-recovery.spec.ts). The same ORDER is staged here
  // with the real server otherwise untouched: the first session read is refused,
  // the plan read therefore runs with no capability, and the capability then
  // arrives. What is asserted is the rule the defect broke - a plan read that
  // re-runs when the capability lands.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(SETTLED_VISITOR);
  let sessionReadsRefused = true;
  await page.route("**/api/plans/*/session", async (route) => {
    if (route.request().method() === "GET" && sessionReadsRefused) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Plan data is temporarily unavailable." }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/plan/${planId}`);
  const retry = page.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible({ timeout: REVEAL_BUDGET_MS });
  await expect(page.getByRole("link", { name: "Join the crew to see the route" })).toBeVisible();

  // The claim lands: the capability cookie is now on this browser, and the
  // session read answers again.
  await context.addCookies([cookie]);
  sessionReadsRefused = false;
  await expect(async () => {
    await retry.click();
    await expect(page.locator("body")).toContainText(venueNames[0]!, { timeout: 2_000 });
  }).toPass({ timeout: REVEAL_BUDGET_MS });

  await expect(
    page.getByRole("link", { name: "Join the crew to see the route" }),
  ).toHaveCount(0);

  await context.close();
});
