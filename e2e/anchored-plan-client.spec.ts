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

// The flag-ON half lives in anchored-plan-client.flag-on.spec.ts (run by the
// chromium-flag-on project against a flag-on build) so neither half needs a
// runtime test.skip. This file is the shipped flag-OFF default behaviour.

const CARRIED = "Carried over from what you accepted";

test("flag-off: the composer shows no carried-over anchor panel", async ({ page }) => {
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: /put it in order/i })).toBeVisible();
  await expect(page.getByText(CARRIED)).toHaveCount(0);
});
