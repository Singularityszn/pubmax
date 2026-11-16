import { expect, test } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

test("a recipient can choose message alerts without enabling public broadcasts", async ({ page }, testInfo) => {
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "B");
  await auth.signedInAs("B");
  await page.route("**/api/messages?**", (route) => route.fulfill({ json: {
    conversations: [{
      id: "11111111-1111-4111-8111-111111111111",
      otherHandle: ACCOUNTS.A.handle,
      lastBody: "Meet at the Lamb at seven?",
      lastAt: new Date().toISOString(),
      lastFromMe: false,
      unread: 1,
    }],
  } }));
  await page.goto("/messages");
  await expect(page.getByRole("link", { name: /Meet at the Lamb/ })).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: testInfo.outputPath(`recipient-${width}.png`), fullPage: true });
  }
  await expect(page.getByRole("button", { name: "Message notifications", exact: true })).toBeVisible();
});
