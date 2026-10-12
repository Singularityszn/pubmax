import { expect, test } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import {
  RECOVERY_OBSERVATION_BUDGET_MS,
  lockInAPlan,
  loseTheCapabilityCookie,
  trackMainFrameDocumentNavigations,
} from "./helpers/planCapabilityRecovery";

test.describe("Plan capability recovery", () => {
  test("a signed-out browser never spends a recovery write", async ({ page }, testInfo) => {
    testInfo.setTimeout(testInfo.timeout + RECOVERY_OBSERVATION_BUDGET_MS);
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    const planId = await lockInAPlan(page);
    await loseTheCapabilityCookie(page, planId);

    // Sign out and clear the seeded session, so the page loads as a stranger.
    await page.evaluate(() => window.localStorage.clear());

    const documentRequestCount = trackMainFrameDocumentNavigations(page);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PATCH"
        && request.url().includes(`/api/plans/${planId}/session`)
      ) {
        writes.push(request.url());
      }
    });

    const reloadResponse = await page.reload();
    expect(reloadResponse?.status(), "public Plan reload succeeds").toBe(200);
    await expect(
      page.getByRole("heading", { name: /^Your night out(?: in .+)?$/ }),
    ).toBeVisible({ timeout: RECOVERY_OBSERVATION_BUDGET_MS });
    // Give the effect the same budget the signed-in case gets before concluding
    // that nothing was sent, so this cannot pass by simply being quicker.
    await page.waitForTimeout(RECOVERY_OBSERVATION_BUDGET_MS);

    expect(
      documentRequestCount(),
      "one main-frame document request after cookie loss",
    ).toBe(1);
    expect(writes, "a signed-out browser sends no recovery PATCH").toEqual([]);
    await expect(
      page.getByRole("button", { name: "Copy invite link" }),
    ).toHaveCount(0);
  });
});
