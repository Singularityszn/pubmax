import { expect, test, type Page } from "@playwright/test";

import type { ConversationDTO } from "../lib/messages";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

type DirectoryMode = "normal" | "fail-first-hari";
type OpenedMessage = Record<string, unknown>;
type Thread = {
  id: string;
  kind: "direct" | "group";
  members: string[];
  title?: string;
};
type PickerJournal = {
  opened: OpenedMessage[];
  sent: OpenedMessage[];
};

const PEOPLE = [
  { id: "profile-hari", handle: "hari", displayName: "Hari" },
  { id: "profile-maisie", handle: "maisie", displayName: "Maisie" },
  { id: "profile-jane", handle: "jane", displayName: "Jane" },
];

async function installPickerFixture(
  page: Page,
  directoryMode: DirectoryMode = "normal",
  people = PEOPLE,
): Promise<PickerJournal> {
  const stub = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await stub.signedInAs("A");
  await page.addInitScript((handle) => {
    window.localStorage.setItem("pubmax_handle", handle);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  }, ACCOUNTS.A.handle);

  const journal: PickerJournal = { opened: [], sent: [] };
  let failHariOnce = directoryMode === "fail-first-hari";
  let activeThread: Thread | null = null;
  const messages: Array<Record<string, unknown>> = [];

  await page.route("**/api/profiles/search**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "hari" && failHariOnce) {
      failHariOnce = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ error: "directory unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({
        matches: people.filter((person) => person.handle.startsWith(query ?? "")),
      }),
    });
  });

  await page.route("**/api/messages**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/messages" && request.method() === "POST") {
      const body = (request.postDataJSON() ?? {}) as OpenedMessage;
      journal.opened.push(body);
      const handle = typeof body.handle === "string" ? body.handle : ACCOUNTS.A.handle;
      let createdThread: Thread;
      if (body.action === "open-group") {
        const participants = Array.isArray(body.participants)
          ? body.participants.filter((item): item is string => typeof item === "string")
          : [];
        createdThread = {
          id: "group-hari-maisie",
          kind: "group",
          members: [handle, ...participants],
          ...(typeof body.title === "string" ? { title: body.title } : {}),
        };
      } else {
        const other = typeof body.other === "string" ? body.other : "hari";
        createdThread = {
          id: `dm-${other}`,
          kind: "direct",
          members: [handle, other],
        };
      }
      activeThread = createdThread;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ conversationId: createdThread.id }),
      });
      return;
    }
    if (path === "/api/messages") {
      const lastMessage = messages.at(-1);
      const conversations: ConversationDTO[] = activeThread ? [{
        id: activeThread.id,
        kind: activeThread.kind,
        otherHandle: activeThread.members[1],
        memberHandles: activeThread.members,
        ...(activeThread.title ? { title: activeThread.title } : {}),
        ...(typeof lastMessage?.body === "string" ? { lastBody: lastMessage.body } : {}),
        lastAt: typeof lastMessage?.createdAt === "string" ? lastMessage.createdAt : "2026-10-01T19:00:00.000Z",
        lastFromMe: lastMessage?.senderHandle === ACCOUNTS.A.handle,
        unread: 0,
      }] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ conversations }),
      });
      return;
    }
    if (request.method() === "POST") {
      const body = (request.postDataJSON() ?? {}) as OpenedMessage;
      journal.sent.push(body);
      const message = {
        id: `message-synthetic-${journal.sent.length}`,
        conversationId: activeThread?.id ?? "group-hari-maisie",
        senderHandle: ACCOUNTS.A.handle,
        body: typeof body.body === "string" ? body.body : "",
        createdAt: "2026-10-01T19:00:00.000Z",
        read: false,
        flagged: false,
      };
      messages.push(message);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ message }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messages,
        ...(activeThread
          ? {
              conversation: {
                id: activeThread.id,
                kind: activeThread.kind,
                members: activeThread.members,
                ...(activeThread.title ? { title: activeThread.title } : {}),
              },
            }
          : {}),
      }),
    });
  });

  return journal;
}

test("a selected public profile starts a direct message from the inbox", async ({
  page,
}, testInfo) => {
  const journal = await installPickerFixture(page);

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
  await page.screenshot({
    path: testInfo.outputPath("recipient-picker-direct-selected.png"),
  });
  await dialog.getByRole("button", { name: "Chat", exact: true }).click();

  await expect.poll(() => journal.opened[0]).toEqual({
    action: "open",
    handle: ACCOUNTS.A.handle,
    other: "hari",
  });
  await expect(page).toHaveURL(/\/messages\/dm-hari$/);
});

test("a named group opens with three members and sends a synthetic message receipt", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const journal = await installPickerFixture(page);
  await page.goto("/messages");
  await page.getByRole("button", { name: "New message" }).click();

  const dialog = page.getByRole("dialog", { name: "New message" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("textbox", { name: "Search people" });
  await search.fill("hari");
  await dialog.getByRole("button", { name: "Add @hari" }).click();
  await search.fill("maisie");
  await dialog.getByRole("button", { name: "Add @maisie" }).click();
  await dialog.getByRole("textbox", { name: "Name it (optional)" }).fill(
    "Synthetic pub crew",
  );
  await page.screenshot({
    path: testInfo.outputPath("recipient-picker-group-selected.png"),
  });
  await dialog.getByRole("button", { name: "Create group" }).click();

  await expect.poll(() => journal.opened[0]).toEqual({
    action: "open-group",
    handle: ACCOUNTS.A.handle,
    participants: ["hari", "maisie"],
    title: "Synthetic pub crew",
  });
  await expect(page).toHaveURL(/\/messages\/group-hari-maisie$/);
  await expect(page.locator(".threadWith")).toContainText("Synthetic pub crew");
  await expect(page.locator(".threadWithMembers")).toHaveText("3 people");
  const groupLink = page.locator('.messagesInboxPane a[href="/messages/group-hari-maisie"]');
  await expect(groupLink).toBeVisible();
  await expect(groupLink).toContainText("Synthetic pub crew");
  await expect(groupLink).toHaveAttribute("aria-current", "page");

  const syntheticMessage = "Synthetic meet-up at the north door at 19:00.";
  await page.locator(".composerInput").fill(syntheticMessage);
  await page.locator(".composerSend").click();
  await expect(page.locator(".messageBubble").last()).toContainText(
    syntheticMessage,
  );
  await expect(page.locator(".messageReadState")).toHaveText("Sent");
  await expect.poll(() => journal.sent[0]).toMatchObject({
    action: "send",
    handle: ACCOUNTS.A.handle,
    body: syntheticMessage,
  });
  await page.screenshot({
    path: testInfo.outputPath("recipient-picker-group-sent.png"),
  });
});

test("unknown prefixes stay disabled and directory failure retries as an error, not an empty result", async ({
  page,
}) => {
  await installPickerFixture(page, "fail-first-hari");
  await page.goto("/messages");
  await page.getByRole("button", { name: "New message" }).click();
  const dialog = page.getByRole("dialog", { name: "New message" });
  const search = dialog.getByRole("textbox", { name: "Search people" });
  await search.fill("hari");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByText("No people found. Try another handle.", { exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Retry search" }).click();
  await expect(dialog.getByRole("button", { name: "Add @hari" })).toBeVisible();

  await search.fill("unknown-prefix");
  await expect(
    dialog.getByText("No people found. Try another handle.", { exact: true }),
  ).toBeVisible();
  const chat = dialog.getByRole("button", { name: "Chat", exact: true });
  await expect(chat).toBeDisabled();
});

const KEYBOARD_LAYOUTS = [
  { name: "phone", width: 390, height: 844, inset: 300 },
  { name: "tablet", width: 768, height: 1024, inset: 300 },
  { name: "landscape", width: 1024, height: 768, inset: 300 },
  { name: "short-landscape", width: 844, height: 390, inset: 100 },
];

for (const layout of KEYBOARD_LAYOUTS) {
  test(`${layout.name} keyboard keeps direct and group actions visible and focusable`, async ({ page }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.addInitScript(() => {
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0 }),
      });
    });
    const people = Array.from({ length: 8 }, (_, i) => ({
      id: `profile-person${i}`, handle: `person${i}`, displayName: `Person ${i}`,
    }));
    await installPickerFixture(page, "normal", people);
    await page.goto("/messages");
    const opener = page.getByRole("button", { name: "New message" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "New message" });
    const search = dialog.getByRole("textbox", { name: "Search people" });
    await expect(search).toBeFocused();
    await page.evaluate((height) => {
      Object.assign(window.visualViewport!, { height });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    }, layout.height - layout.inset);
    if (layout.width <= 640) {
      const tabBar = page.locator(".mobileTabBar").filter({ visible: true });
      await expect(tabBar).toHaveAttribute("aria-hidden", "true");
      await expect(tabBar).toHaveAttribute("inert", "");
      const layering = await page.evaluate(() => {
        const backdrop = document.querySelector<HTMLElement>(".messagesNewGroupBackdrop")!;
        const bar = document.querySelector<HTMLElement>(".mobileTabBar")!;
        return {
          picker: Number.parseInt(getComputedStyle(backdrop).zIndex, 10),
          bar: Number.parseInt(getComputedStyle(bar).zIndex, 10),
          barBottom: bar.getBoundingClientRect().bottom,
          visibleBottom: window.visualViewport!.height,
        };
      });
      expect(layering.picker).toBeGreaterThan(layering.bar);
      expect(layering.barBottom).toBeGreaterThan(layering.visibleBottom);
    }
    await search.fill("person");
    await expect(dialog.locator(".messagesNewGroupResult")).toHaveCount(8);
    await expect(search).toBeFocused();

    const assertActions = async () => {
      await expect.poll(() => dialog.evaluate((element) => {
        const visibleBottom = window.visualViewport!.height;
        const bounds = element.getBoundingClientRect();
        return bounds.top >= 0 && bounds.bottom <= visibleBottom;
      })).toBe(true);
      for (const action of [dialog.locator(".messagesNewGroupCreate"), dialog.getByRole("button", { name: "Cancel", exact: true })]) {
        expect(await action.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return box.top >= 0 && box.bottom <= window.visualViewport!.height &&
            box.left >= 0 && box.right <= window.innerWidth && Boolean(hit && element.contains(hit));
        })).toBe(true);
      }
    };
    await assertActions();
    await expect(dialog.getByRole("button", { name: "Chat", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Add @person0" }).click();
    await expect(search).toBeFocused();
    await search.fill("person");
    await expect(dialog.locator(".messagesNewGroupResult")).toHaveCount(8);
    await expect(dialog.getByRole("button", { name: "Chat", exact: true })).toBeEnabled();
    await assertActions();
    await dialog.getByRole("button", { name: "Add @person1" }).click();
    await expect(search).toBeFocused();
    await search.fill("person");
    await expect(dialog.locator(".messagesNewGroupResult")).toHaveCount(8);
    await expect(dialog.getByRole("button", { name: "Create group", exact: true })).toBeEnabled();
    await assertActions();
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    await cancel.focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close new message" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
}

const PICKER_LAYOUTS = [
  { name: "desktop-light", width: 1440, height: 900, colorScheme: "light" as const },
  { name: "desktop-dark", width: 1440, height: 900, colorScheme: "dark" as const },
  { name: "mobile-light", width: 390, height: 844, colorScheme: "light" as const },
  { name: "mobile-dark", width: 390, height: 844, colorScheme: "dark" as const },
];

for (const layout of PICKER_LAYOUTS) {
  test(`${layout.name} picker fits, traps focus, escapes, and restores focus`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.emulateMedia({ colorScheme: layout.colorScheme });
    await installPickerFixture(page);
    await page.addInitScript((theme: "light" | "dark") => {
      window.localStorage.setItem("pubmax-theme", theme);
      document.documentElement.setAttribute("data-theme", theme);
    }, layout.colorScheme);
    await page.goto("/messages");

    const opener = page.getByRole("button", { name: "New message" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "New message" });
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole("textbox", { name: "Search people" });
    await expect(search).toBeFocused();
    expect(
      await page.evaluate(() =>
        document.documentElement.dataset.theme,
      ),
    ).toBe(layout.colorScheme);

    const viewport = page.viewportSize()!;
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
        ),
      )
      .toBe(true);

    const focusable = dialog.locator(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
    );
    const count = await focusable.count();
    expect(count).toBeGreaterThanOrEqual(2);
    const first = focusable.first();
    const last = focusable.last();
    await last.focus();
    await page.keyboard.press("Tab");
    await expect(first).toBeFocused();
    await first.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();

    await page.screenshot({
      path: testInfo.outputPath(`recipient-picker-${layout.name}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
}
