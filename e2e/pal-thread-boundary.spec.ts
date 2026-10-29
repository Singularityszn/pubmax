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

test("a preset question waits for the saved conversation to load", async ({ page }) => {
  await installAuthDoubles(page);
  const asks: Array<{ query: string; turns: Array<{ role: string; content: string }> }> = [];
  await page.route("**/api/pub-pal/chat", async (route) => {
    if (route.request().method() === "POST") asks.push(route.request().postDataJSON());
    await route.fulfill({ json: { answer: route.request().method() === "POST" ? "Your Soho choices are in this conversation." : "Hi. What kind of night are you planning?", cards: [], proposals: [], conversationId: "conv_presetrestore1" } });
  });
  await page.goto("/pal/chat");
  await expect(page.getByRole("textbox", { name: "Where, how many, what budget", exact: true })).toBeEnabled();
  const initialScripts = new Set(await page.locator("script[src]").evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).src)));
  await seedSignedIn(page, "A");
  await page.goto("/pal/chat");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  const firstQuestion = "Find me four pubs in Soho";
  await page.getByRole("textbox", { name: "Where, how many, what budget", exact: true }).fill(firstQuestion);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect.poll(() => asks.length).toBe(1);
  await expect(page.locator(".palChatRow--user")).toHaveCount(1);
  await expect(page.getByText("Your Soho choices are in this conversation.", { exact: true })).toBeVisible();
  let release!: () => void;
  const loading = new Promise<void>((resolve) => { release = resolve; });
  let held = 0;
  await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/, async (route) => {
    if (!initialScripts.has(route.request().url())) {
      held += 1;
      await loading;
    }
    await route.continue();
  });
  const preset = "Same area, under £6 a pint";
  try {
    await page.goto(`/pal/chat?ask=${encodeURIComponent(preset)}`, { waitUntil: "domcontentloaded" });
    await expect.poll(() => held).toBeGreaterThan(0);
    await expect(page.getByRole("textbox", { name: "Where, how many, what budget", exact: true })).toBeDisabled();
    expect(asks).toHaveLength(1);
  } finally {
    release();
  }
  await expect.poll(() => asks.length).toBe(2);
  expect(asks[1]?.query).toBe(preset);
  expect(asks[1]?.turns).toContainEqual({ role: "user", content: firstQuestion });
});
