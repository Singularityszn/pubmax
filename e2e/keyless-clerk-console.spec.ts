import { expect, test } from "@playwright/test";

test("does not boot Clerk JS when PUBMAXX has no Clerk keys", async ({ page }) => {
  const clerkFailures: string[] = [];
  const record = (message: string) => {
    if (/clerk-js|failed_to_load_clerk_js|ClerkRuntimeError/i.test(message)) {
      clerkFailures.push(message);
    }
  };

  page.on("console", (message) => {
    if (message.type() === "error") record(message.text());
  });
  page.on("pageerror", (error) => record(error.message));

  const response = await page.goto("/tonight");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Clerk's keyless loader starts after hydration. Keep this wait long enough
  // to catch the real delayed script request without coupling to other fetches.
  await page.waitForTimeout(1_500);

  expect(clerkFailures).toEqual([]);
});
