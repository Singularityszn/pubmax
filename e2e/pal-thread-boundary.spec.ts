import { expect, test } from "@playwright/test";
import { ACCOUNTS, installAuthDoubles, readDeviceIdentity, seedSignedIn } from "./helpers/authDoubles";

test("the current chat survives a tab reload and leaves with its account", async ({ page }) => {
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  let requests = 0;
  await page.route("**/api/pub-pal/chat", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { answer: "Hi. What kind of night are you planning?", cards: [], proposals: [], conversationId: "conv_openingboundary1" } });
      return;
    }
    requests += 1;
    await route.fulfill({ json: { answer: "Your private cask preference is in this conversation.", cards: [], proposals: [], conversationId: "conv_returntest1" } });
  });
  await page.goto("/pal/chat");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await page.getByRole("textbox", { name: "Where, how many, what budget", exact: true }).fill("I like cask ale");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Your private cask preference is in this conversation.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Your private cask preference is in this conversation.", { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await auth.signedInAs("B");
  await page.reload();
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect(page.getByText("Your private cask preference is in this conversation.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".palChatRow--user")).toHaveCount(0);
  await expect(page.getByText("Hi. What kind of night are you planning?", { exact: true })).toBeVisible();
});
