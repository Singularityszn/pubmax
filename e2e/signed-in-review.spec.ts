import { expect, test } from "@playwright/test";

import { signInWithQaAccount } from "./helpers/realAuth";

test.setTimeout(90_000);

test("signs in through the real handle-password path and resolves /u/you", async ({ page }) => {
  await signInWithQaAccount(page);
  await page.goto("/u/you");
  await expect(page).toHaveURL(/\/u\/e2e_qa(?:\?|$)/);
  await expect(page.getByText("@e2e_qa", { exact: true }).first()).toBeVisible();
});
