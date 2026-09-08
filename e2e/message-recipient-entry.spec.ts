import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

async function installInbox(page: Page) {
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await auth.signedInAs("A");
  await page.route("**/api/messages?**", route => route.fulfill({ json: {
    conversations: [{ id: "c1", otherHandle: "sam", lastAt: new Date().toISOString(), lastFromMe: false }],
  } }));
  await page.route("**/api/messages/c1**", route => route.fulfill({ json: {
    messages: [], otherHandle: "sam", conversationId: "c1",
  } }));
}

for (const width of [390, 1440]) {
  test.describe(`recipient entry at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("inbox opens recipient search, retries a failed read, and opens the existing conversation", async ({ page }, testInfo) => {
      await installInbox(page);
      await page.addInitScript(() => {
        const runtime = window as typeof window & { recipientErrorResponse?: Response };
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const response = await originalFetch(input, init);
          const url = new URL(input instanceof Request ? input.url : String(input), location.href);
          if (url.pathname === "/api/profiles/search" && !response.ok) {
            runtime.recipientErrorResponse = response;
          }
          return response;
        };
      });
      let searches = 0;
      const actions: unknown[] = [];
      await page.route("**/api/profiles/search?**", route => {
        searches++;
        return route.fulfill(searches === 1
          ? { status: 503, json: { error: "Unavailable" } }
          : { json: { matches: [{ handle: "sam" }, { handle: ACCOUNTS.A.handle }] } });
      });
      await page.route("**/api/messages", route => {
        actions.push(route.request().postDataJSON());
        return route.fulfill({ json: { conversationId: "c1" } });
      });
      await page.goto("/messages");
      await expect(page.locator(".conversationList li")).toHaveCount(1);
      await page.getByRole("link", { name: "New message", exact: true }).click();
      await expect(page).toHaveURL(/\/messages\/new$/);
      await expect(page.getByRole("heading", { name: "New message", exact: true })).toBeVisible();
      await page.getByRole("searchbox", { name: "Search handles" }).fill("sam");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Could not search. Try again." })).toBeVisible();
      // The actual failed fetch body is released before another action aborts it.
      await expect.poll(() => page.evaluate(() => (
        window as typeof window & { recipientErrorResponse?: Response }
      ).recipientErrorResponse?.bodyUsed)).toBe(true);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const result = page.locator(".messageRecipientRow");
      await expect(result).toHaveCount(1);
      await expect(result.getByRole("link")).toHaveText("@sam");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`recipients-${width}.png`), fullPage: true });
      await result.getByRole("button", { name: "Message", exact: true }).click();
      await expect(page).toHaveURL(/\/messages\/c1$/);
      expect(actions).toEqual([{ action: "open", handle: ACCOUNTS.A.handle, other: "sam" }]);
    });

    test("does not offer a handle claim while canonical identity is pending", async ({ page }) => {
      await installInbox(page);
      let releaseIdentity!: () => void;
      const held = new Promise<void>(resolve => { releaseIdentity = resolve; });
      let requested = false;
      await page.route("**/api/identity/handle/current", async route => {
        requested = true;
        await held;
        await route.fulfill({ json: { handle: ACCOUNTS.A.handle } });
      });
      try {
        await page.goto("/messages/new");
        await expect.poll(() => requested).toBe(true);
        await expect(page.getByRole("status").filter({ hasText: "Checking your account" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Claim a handle to message" })).toHaveCount(0);
        await expect(page.getByRole("searchbox", { name: "Search handles" })).toHaveCount(0);
      } finally {
        releaseIdentity();
      }
      await expect(page.getByRole("searchbox", { name: "Search handles" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Claim a handle to message" })).toHaveCount(0);
    });
  });
}
