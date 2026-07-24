import { test, expect } from "@playwright/test";

// DAG L11 flag-ON half (from PR #587), split out of anchored-plan-client.spec.ts
// so neither half needs a runtime test.skip (L20 zero-skip contract). This file
// runs ONLY in the flag-on invocation: the `chromium-flag-on` project drives a
// server built with anchoredGeneration + intentRead ON (playwright.config webServer
// env pass-through), so the assertion below always executes — no self-gate.
//
// With both flags on, a seeded acceptance (PlanningIntent) is consumed by the
// composer as the editable "Carried over" summary before intake, instead of
// re-asking it. The deeper flag-on GENERATION scenarios (atomic one→three
// upgrade, plan_accepted-once, Friend-sees-same-date) need live anchored
// generation the keyless e2e server can't produce deterministically; those stay
// covered by L09/L11 unit tests.

const INTENT_KEY = "pubmax:planning-intent:v1";
const CARRIED = "Carried over from what you accepted";

test("flag-on: a seeded acceptance surfaces as the carried-over panel", async ({ page, request }) => {
  const venues = (await (await request.get("/data/venues_slim.json")).json()) as Array<{ id: string; name: string }>;
  const venueId = venues[0]?.id;
  expect(typeof venueId).toBe("string");

  await page.addInitScript(
    ([id, key]) => {
      const now = Date.now();
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          source: "near",
          cityId: "london",
          acceptedVenueId: id,
          acceptedArea: { kind: "night-patch", id: "soho" },
          startsAt: null,
          displayEvidence: { kind: "price", observedAt: null },
          acceptedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
        }),
      );
    },
    [venueId, INTENT_KEY] as const,
  );

  await page.goto("/plan");
  // The accepted context is consumed as an editable summary before intake.
  await expect(page.getByText(CARRIED)).toBeVisible();
  // The accepted Venue is carried into the summary (pre-answered, not re-asked).
  await expect(page.locator("body")).toContainText(venueId as string);
});
