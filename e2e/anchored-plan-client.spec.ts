import { test, expect } from "@playwright/test";

// DAG L11 deferred e2e (from PR #587). The anchored composer consumes accepted
// context instead of re-asking it: with intentRead + anchoredGeneration ON, a
// seeded acceptance (PlanningIntent) surfaces as the editable "Carried over"
// summary before intake. Both flags off ⇒ the panel never renders (the legacy
// composer, offBehavior per lib/trustedHandoffFlags.server.ts).
//
// The flag-ON loop scenarios from the outline (one→three atomic upgrade,
// plan_accepted-once, Friend-sees-same-date) require live anchored GENERATION,
// which the keyless e2e server cannot produce deterministically — those stay
// covered by L09/L11 unit tests and are documented as deferred for L20.

const INTENT_KEY = "pubmax:planning-intent:v1";
const CARRIED = "Carried over from what you accepted";

test("flag-off: the composer shows no carried-over anchor panel", async ({ page }) => {
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: /put it in order/i })).toBeVisible();
  await expect(page.getByText(CARRIED)).toHaveCount(0);
});

test("flag-on: a seeded acceptance surfaces as the carried-over panel", async ({ page, request }) => {
  test.skip(
    process.env.PUBMAX_ANCHORED_GENERATION !== "1" || process.env.PUBMAX_TRUSTED_HANDOFF_INTENT_READ !== "1",
    "needs anchoredGeneration + intentRead on — run with both flags exported",
  );

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
