import { expect, test } from "@playwright/test";
import { ACCOUNTS, installAuthDoubles, readDeviceIdentity, seedSignedIn } from "./helpers/authDoubles";

const greeting = 'Hi, I\'m Ripley. You told me: "I visited The Crown on 10 October 2026, drank Camden Hells and spent £26.80 in total." Something similar tonight?';
const reply = "Which area and price per pint should I use for something similar?";
const generic = "Hi. What kind of night are you planning?";
const body = (answer: string, conversationId = "conv_openingtest1") => ({ answer, cards: [], proposals: [], sources: [], conversationId });
const fieldName = "Where, how many, what budget";

test("a new owned chat opens with the authorized report, retains its follow-up and restores the thread", async ({ page }) => {
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  let openings = 0;
  let posts = 0;
  await page.route("**/api/pub-pal/chat", async (route) => {
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    if (route.request().method() === "GET") {
      openings += 1;
      return route.fulfill({ json: body(greeting) });
    }
    posts += 1;
    const request = route.request().postDataJSON();
    expect(request.query).toBe("Yes");
    expect(request.threadId).toBe("conv_openingtest1");
    expect(request.turns).toEqual([{ role: "assistant", content: greeting }]);
    return route.fulfill({ json: body(`${greeting} ${reply}`) });
  });
  await page.goto("/pal/chat");
  await expect(page.getByText(greeting, { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: fieldName }).fill("Yes");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText(`${greeting} ${reply}`, { exact: true })).toBeVisible();
  expect(posts).toBe(1);
  await page.reload();
  await expect(page.getByText(`${greeting} ${reply}`, { exact: true })).toBeVisible();
  expect(openings).toBe(1);
});

test("a delayed opening keeps a draft intact and cannot overwrite a question or its answer", async ({ page }) => {
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let reading = false;
  let openingDelivered = false;
  let releaseAnswer!: () => void;
  const answerPending = new Promise<void>(resolve => { releaseAnswer = resolve; });
  await page.route("**/api/pub-pal/chat", async route => {
    if (route.request().method() === "GET") {
      reading = true;
      await delayed;
      await route.fulfill({ json: body(greeting) });
      openingDelivered = true;
    } else {
      await answerPending;
      await route.fulfill({ json: body("Your question has its own answer.", "conv_questiontest1") });
    }
  });
  await page.goto("/pal/chat");
  await expect.poll(() => reading).toBe(true);
  const field = page.getByRole("textbox", { name: fieldName });
  await field.fill("Four pubs in Soho");
  await expect(field).toHaveValue("Four pubs in Soho");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".palChatBubble--pending")).toBeVisible();
  release();
  await expect.poll(() => openingDelivered).toBe(true);
  await expect(page.getByText(greeting, { exact: true })).toHaveCount(0);
  await expect(page.locator(".palChatBubble--pending")).toBeVisible();
  releaseAnswer();
  await expect(page.getByText("Your question has its own answer.", { exact: true })).toBeVisible();
  await expect(page.locator(".palChatRow--user")).toHaveCount(1);
});

test("a delayed opening preserves an unsent draft when it arrives", async ({ page }) => {
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/pub-pal/chat", async route => {
    await delayed;
    await route.fulfill({ json: body(greeting) });
  });
  const ownedRead = page.waitForRequest(request => new URL(request.url()).pathname === "/api/pub-pal/chat" && request.method() === "GET");
  await page.goto("/pal/chat");
  expect((await ownedRead).headers().authorization).toMatch(/^Bearer /);
  const field = page.getByRole("textbox", { name: fieldName });
  await field.fill("A quiet night");
  release();
  await expect(page.getByText(greeting, { exact: true })).toBeVisible();
  await expect(field).toHaveValue("A quiet night");
});

test("an account change retires a delayed opening without leaking the previous report", async ({ page }) => {
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await auth.signedInAs("B");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await auth.signedInAs("A");
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  await page.route("**/api/pub-pal/chat", async route => {
    reads += 1;
    if (reads === 1) {
      await delayed;
      await route.fulfill({ json: body(greeting) });
    } else await route.fulfill({ json: body(generic, "conv_otherownertest1") });
  });
  await page.goto("/pal/chat");
  await expect.poll(() => reads).toBe(1);
  await page.getByRole("button", { name: /Account options/ }).click();
  await page.locator(".authAccountMenu").getByRole("button", { name: "Switch account", exact: true }).click();
  await page.locator(".authSwitcherRow").filter({ hasText: `@${ACCOUNTS.B.handle}` }).click();
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect.poll(() => reads).toBe(2);
  release();
  await expect(page.getByText(generic, { exact: true })).toBeVisible();
  await expect(page.getByText(greeting, { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: fieldName }).fill("My own question");
  await expect(page.getByRole("textbox", { name: fieldName })).toHaveValue("My own question");
});


test("New conversation retires a delayed opening from the previous thread", async ({ page }) => {
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  let oldDelivered = false;
  await page.route("**/api/pub-pal/chat", async route => {
    if (route.request().method() !== "GET") return route.fulfill({ json: body("Your first answer.", "conv_firstanswer1") });
    reads += 1;
    if (reads === 1) {
      await delayed;
      await route.fulfill({ json: body(greeting) });
      oldDelivered = true;
    } else await route.fulfill({ json: body(generic, "conv_freshopening1") });
  });
  await page.goto("/pal/chat");
  await expect.poll(() => reads).toBe(1);
  await page.getByRole("textbox", { name: fieldName }).fill("Four pubs in Soho");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Your first answer.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New conversation", exact: true }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByText(generic, { exact: true })).toBeVisible();
  release();
  await expect.poll(() => oldDelivered).toBe(true);
  await expect(page.getByText(greeting, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Your first answer.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".palChatRow--user")).toHaveCount(0);
});
