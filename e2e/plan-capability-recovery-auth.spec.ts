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

test("a restored host rotates an invite after cookie loss without document navigation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInWithQaAccount(page);
  const planId = await lockInAPlan(page, { waitForAccountClaim: true });
  await page.reload();
  const nightMode = page.getByRole("dialog", { name: "Night mode" });
  await expect(nightMode).toBeVisible();
  await nightMode.getByRole("button", { name: "View full plan", exact: true }).click();
  await expect(nightMode).toBeHidden();
  const newLink = page.getByRole("button", { name: "New link", exact: true });
  await expect(newLink).toBeVisible();
  await loseTheCapabilityCookie(page, planId);
  const documentRequestCount = trackMainFrameDocumentNavigations(page);
  const started = Date.now();
  const responses = Promise.all([
    page.waitForResponse((response) => response.request().method() === "PATCH"
      && response.url().endsWith(`/api/plans/${planId}/session`),
    { timeout: RECOVERY_OBSERVATION_BUDGET_MS }),
    page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith(`/api/plans/${planId}/invite-rotate`)
      && response.ok(), { timeout: RECOVERY_OBSERVATION_BUDGET_MS }),
  ]);
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.accept();
  });

  await newLink.click();
  const [recovery, rotation] = await responses;

  expect(recovery.status()).toBe(200);
  expect(recovery.request().headers()["idempotency-key"]).toBeTruthy();
  expect(rotation.status()).toBe(200);
  await expect(page.getByText("New link ready. The old one stopped working.", { exact: true })).toBeVisible({
    timeout: Math.max(1, RECOVERY_OBSERVATION_BUDGET_MS - (Date.now() - started)),
  });
  expect(Date.now() - started).toBeLessThanOrEqual(RECOVERY_OBSERVATION_BUDGET_MS);
  expect(documentRequestCount(), "the host action recovers in the same document").toBe(0);
  const cookie = (await page.context().cookies()).find((entry) => entry.name === CAPABILITY_COOKIE(planId));
  expect(cookie?.httpOnly, "the restored capability remains script-inaccessible").toBe(true);
  await page.screenshot({ path: testInfo.outputPath("plan-host-action-recovered.png") });
});
