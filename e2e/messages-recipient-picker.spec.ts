import { expect, test } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

test("a selected public profile starts a direct message from the inbox", async ({
  page,
}) => {
  const stub = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await stub.signedInAs("A");
  await page.addInitScript((handle) => {
    window.localStorage.setItem("pubmax_handle", handle);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  }, ACCOUNTS.A.handle);

  let openedRequest: Record<string, unknown> | null = null;
  await page.route("**/api/profiles/search**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({
        matches:
          query === "hari"
            ? [
                {
                  id: "profile-hari",
                  handle: "hari",
                  displayName: "Hari",
                  avatarUrl: null,
                },
              ]
            : [],
      }),
    });
  });
  await page.route("**/api/messages**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/messages" && request.method() === "POST") {
      openedRequest = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ conversationId: "dm-hari" }),
      });
      return;
    }
    if (path === "/api/messages") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ conversations: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messages: [],
        conversation: { id: "dm-hari", otherHandle: "hari" },
      }),
    });
  });

  await page.goto("/messages");
  const openPicker = page.getByRole("button", { name: "New message" });
  await expect(openPicker).toBeVisible();
  await openPicker.click();

  const dialog = page.getByRole("dialog", { name: "New message" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Search people" }).fill("hari");
  const addHari = dialog.getByRole("button", { name: "Add @hari" });
  await expect(addHari).toBeVisible();
  await addHari.click();
  await dialog.getByRole("button", { name: "Chat", exact: true }).click();

  await expect.poll(() => openedRequest).toEqual({
    action: "open",
    handle: ACCOUNTS.A.handle,
    other: "hari",
  });
  await expect(page).toHaveURL(/\/messages\/dm-hari$/);
});
