import { expect, test } from "@playwright/test";

import {
  CAPABILITY_COOKIE,
  RECOVERY_OBSERVATION_BUDGET_MS,
  lockInAPlan,
  loseTheCapabilityCookie,
  trackMainFrameDocumentNavigations,
} from "./helpers/planCapabilityRecovery";
import { signInWithQaAccount } from "./helpers/realAuth";

test.setTimeout(90_000);

test("a signed-in host who lost the capability cookie recovers it on the Plan page", async ({ page }, testInfo) => {
  await signInWithQaAccount(page);
  const planId = await lockInAPlan(page, { waitForAccountClaim: true });
  await loseTheCapabilityCookie(page, planId);
  const documentRequestCount = trackMainFrameDocumentNavigations(page);
  const recovery = page.waitForResponse(
    (response) => response.request().method() === "PATCH"
      && response.url().endsWith(`/api/plans/${planId}/session`),
    { timeout: RECOVERY_OBSERVATION_BUDGET_MS },
  );

  await page.reload();
  const response = await recovery;
  expect(response.status(), "the real account recovers its capability").toBe(200);
  expect(response.request().headers()["idempotency-key"], "recovery has an idempotency key").toBeTruthy();
  await expect(page.getByRole("button", { name: "Copy invite link" })).toBeVisible({
    timeout: RECOVERY_OBSERVATION_BUDGET_MS,
  });
  expect(documentRequestCount(), "one main-frame document request after cookie loss").toBe(1);
  expect(
    (await page.context().cookies()).some((cookie) => cookie.name === CAPABILITY_COOKIE(planId)),
    "the capability cookie is restored",
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("plan-capability-recovered.png") });
});
