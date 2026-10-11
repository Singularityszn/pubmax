import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type QaCredentials = { handle: string; password: string };

/** Use the seeded identity through the real handle-password route. */
export async function signInWithQaAccount(page: Page): Promise<void> {
  let credentials: QaCredentials;
  try {
    credentials = JSON.parse(
      readFileSync(resolve(process.cwd(), ".e2e", "qa-credentials.json"), "utf8"),
    ) as QaCredentials;
  } catch {
    throw new Error("Missing .e2e/qa-credentials.json. Run npm run e2e:seed first.");
  }
  await page.goto("/login");
  await expect(async () => {
    await page.getByTestId("e2e-login-toggle").click();
    await expect(page.getByTestId("e2e-login-handle")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByTestId("e2e-login-handle").fill(credentials.handle);
  await page.getByTestId("e2e-login-password").fill(credentials.password);
  await page.getByTestId("e2e-login-submit").click();
  await expect(page.getByRole("heading", { name: "You are signed in" })).toBeVisible();
}
