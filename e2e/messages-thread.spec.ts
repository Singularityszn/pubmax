import { expect, test, type Page } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// The thread a person actually types into, measured on a production build.
//
// A keyless server cannot verify a bearer, so the messages API is answered in
// the browser with a fixed conversation; the auth doubles sign the page in as
// account A. What is measured is the RENDERED geometry of the shipped markup
// and stylesheet: the composer pinned in view, above the tab bar and above a
// keyboard-sized cut of the viewport; the newest message in view after a
// send; Send a 44px circle with its arrow centred; the head naming the other
// person; no sideways scroll at 320.
//
// The captain's report was "the messaging is slow and ui is broken"; the
// before shots are docs/proof/messaging-ui/before.

const PHONE = { width: 390, height: 844 };
const PHONE_WITH_KEYBOARD = { width: 390, height: 480 };
const NARROW = { width: 320, height: 568 };
const DESKTOP = { width: 1440, height: 900 };

const ME = ACCOUNTS.A.handle;
const THEM = "karansznx";

type Row = {
  id: string;
  conversationId: string;
  senderHandle: string;
  body: string;
  createdAt: string;
  read: boolean;
  flagged: boolean;
};

function fixture(): Row[] {
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const row = (id: string, senderHandle: string, body: string, minutesAgo: number, read = true): Row => ({
    id,
    conversationId: "c1",
    senderHandle,
    body,
    createdAt: at(minutesAgo),
    read,
    flagged: false,
  });
  return [
    row("m1", THEM, "Alright, where tonight?", 60 * 24 + 40),
    row("m2", ME, "The Lamb on Lamb's Conduit St. £5.60 a pint, confirmed Tuesday.", 60 * 24 + 30),
    row(
      "m3",
      THEM,
      "Go on then. Is it the one with the snob screens? I want to sit outside if it stays dry, the forecast says it might not, but a bit of rain never stopped anyone on that street.",
      60 * 24 + 20,
    ),
    row("m4", ME, "Yeah that one. @maisie is coming too", 60 * 24 + 10),
    row("m5", THEM, "https://pubmaxxing.com/map?sel=venue-uk-osm-123456789&brand=guinness", 60 * 3),
    row("m6", ME, "Ok", 40),
    row("m7", THEM, "Sound, see you at the Lamb at 7", 3, false),
    row("m8", THEM, "Bring cash, card machine is dodgy", 2, false),
  ];
}

/** Sign the page in as account A and answer the messages API in the browser. */
async function installThread(page: Page, rows: Row[]): Promise<void> {
  const stub = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await stub.signedInAs("A");
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax_handle", "karan");
  });
  await page.route("**/api/messages?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        conversations: [
          {
            id: "c1",
            otherHandle: THEM,
            lastBody: rows.at(-1)?.body ?? "",
            lastAt: rows.at(-1)?.createdAt ?? new Date().toISOString(),
            lastFromMe: false,
            unread: 2,
          },
          { id: "c4", otherHandle: "tom_the_lamb", lastAt: new Date().toISOString(), lastFromMe: false, unread: 0 },
        ],
      }),
    }),
  );
  await page.route("**/api/messages/c1**", async (route) => {
    if (route.request().method() === "POST") {
      const post = (route.request().postDataJSON() ?? {}) as { body?: string };
      rows.push({
        id: `m${rows.length + 1}`,
        conversationId: "c1",
        senderHandle: ME,
        body: post.body ?? "",
        createdAt: new Date().toISOString(),
        read: false,
        flagged: false,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: rows.at(-1) }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: rows }),
    });
  });
  await page.route("**/api/messages/c4**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: [] }) }),
  );
  await page.route("**/api/messages/cfail**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "down" }) }),
  );
}

type Box = { top: number; bottom: number; left: number; right: number; width: number; height: number };

async function box(page: Page, selector: string): Promise<Box> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) throw new Error(`missing ${sel}`);
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height,
    };
  }, selector);
}

async function expectNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
        })),
      { message: `document should not horizontally overflow at ${width}px` },
    )
    .toEqual({ clientWidth: width, scrollWidth: width, bodyScrollWidth: width });
}

/** The composer dock is on screen, whole, and clear of the tab bar's pill. */
async function expectComposerInView(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const dock = await box(page, ".composerDock");
  expect(dock.top, "composer top inside the viewport").toBeGreaterThanOrEqual(0);
  expect(dock.bottom, "composer bottom inside the viewport").toBeLessThanOrEqual(viewport!.height + 1);
  const pill = page.locator(".mobileTabList");
  if ((await pill.count()) > 0 && (await pill.isVisible())) {
    const pillBox = await box(page, ".mobileTabList");
    expect(dock.bottom, "composer sits above the tab bar's pill").toBeLessThanOrEqual(pillBox.top + 1);
  }
  // Nothing is painted over the field: the top-most element at its centre is
  // the field itself.
  const owner = await page.evaluate(() => {
    const field = document.querySelector(".composerInput");
    if (!field) return "missing";
    const rect = field.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return top === field ? "field" : `${top?.tagName.toLowerCase()}.${top?.className ?? ""}`;
  });
  expect(owner).toBe("field");
}

/** A bubble carrying `text` is wholly on screen and above the composer. */
async function expectMessageInView(page: Page, text: string): Promise<void> {
  const bubble = page.locator(".messageBubble", { hasText: text }).last();
  await expect(bubble).toBeVisible();
  const [bubbleBox, dock] = await Promise.all([bubble.boundingBox(), box(page, ".composerDock")]);
  expect(bubbleBox).not.toBeNull();
  expect(bubbleBox!.y, `${text}: top inside the viewport`).toBeGreaterThanOrEqual(0);
  expect(bubbleBox!.y + bubbleBox!.height, `${text}: sits above the composer`).toBeLessThanOrEqual(dock.top + 1);
}

/** Send is a 44px circle, and the arrow inside it is dead centre. */
async function expectSendCentred(page: Page): Promise<void> {
  const measured = await page.evaluate(() => {
    const button = document.querySelector(".composerSend");
    const icon = button?.querySelector("svg");
    if (!button || !icon) throw new Error("missing send or its icon");
    const b = button.getBoundingClientRect();
    const i = icon.getBoundingClientRect();
    return {
      width: b.width,
      height: b.height,
      dx: Math.abs(b.left + b.width / 2 - (i.left + i.width / 2)),
      dy: Math.abs(b.top + b.height / 2 - (i.top + i.height / 2)),
      radius: getComputedStyle(button).borderRadius,
    };
  });
  expect(measured.width).toBeGreaterThanOrEqual(44);
  expect(measured.height).toBeGreaterThanOrEqual(44);
  expect(measured.dx, "arrow horizontally centred").toBeLessThanOrEqual(1);
  expect(measured.dy, "arrow vertically centred").toBeLessThanOrEqual(1);
  expect(measured.radius).toBe("50%");
}

test.describe("the message thread on a phone", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await installThread(page, fixture());
  });

  test("names the other person, pins the composer, opens on the newest message", async ({ page }) => {
    await page.goto("/messages/c1");
    await expect(page.locator(".threadWith")).toContainText(`@${THEM}`);
    await expect(page.locator(".threadMessages .messageBubble")).toHaveCount(8);

    await expectComposerInView(page);
    await expectMessageInView(page, "Bring cash, card machine is dodgy");
    await expectSendCentred(page);
    await expectNoHorizontalOverflow(page, PHONE.width);

    // The page hides the floating compose control: it sat over Send.
    await expect(page.locator(".createFabRoot")).toBeHidden();
  });

  test("a send lands in view at once, then stays in view when the server answers", async ({ page }) => {
    await page.goto("/messages/c1");
    await expect(page.locator(".threadMessages .messageBubble")).toHaveCount(8);

    const field = page.locator(".composerInput");
    await field.fill("On my way, two minutes");
    await expect(page.locator(".composerSend")).toBeEnabled();
    await page.locator(".composerSend").click();

    // The optimistic bubble, and the field cleared, before any answer.
    await expectMessageInView(page, "On my way, two minutes");
    await expect(field).toHaveValue("");
    // The stored row replaces it: still nine bubbles, still in view.
    await expect(page.locator(".threadMessages .messageBubble")).toHaveCount(9);
    await expect(page.locator(".messageRow[data-sending]")).toHaveCount(0);
    await expectMessageInView(page, "On my way, two minutes");
    await expect(page.locator(".messageReadState")).toHaveText("Sent");
  });

  test("keeps the composer and the newest message in view with the keyboard up", async ({ page }) => {
    await page.goto("/messages/c1");
    await expect(page.locator(".threadMessages .messageBubble")).toHaveCount(8);
    // A keyboard-sized cut of the viewport, with the field focused.
    await page.setViewportSize(PHONE_WITH_KEYBOARD);
    await page.locator(".composerInput").focus();
    await expectComposerInView(page);
    await expectMessageInView(page, "Bring cash, card machine is dodgy");
  });

  test("a tapped bubble reveals its own time and the Report control", async ({ page }) => {
    await page.goto("/messages/c1");
    const row = page.locator(".messageRow", { hasText: "Alright, where tonight?" });
    const meta = row.locator(".messageMeta");
    await expect(meta).toHaveCSS("opacity", "0");
    await row.locator(".messageBubble").click();
    await expect(row).toHaveAttribute("data-revealed", "");
    await expect(meta).toHaveCSS("opacity", "1");
    await expect(meta.locator("time")).toHaveText(/^\d{2}:\d{2}$/);
    await expect(meta.getByRole("button", { name: "Report" })).toBeVisible();
  });

  test("an empty thread and a failed one each say so", async ({ page }) => {
    await page.goto("/messages/c4");
    await expect(page.locator(".threadEmpty")).toContainText("Say hello");
    await expect(page.locator(".threadWith")).toContainText("@tom_the_lamb");
    await expectComposerInView(page);

    await page.goto("/messages/cfail");
    await expect(page.locator(".threadFailure")).toContainText("Your messages are safe");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

test.describe("the message thread at 320", () => {
  test("never scrolls sideways, and every control keeps 44px", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await installThread(page, fixture());
    await page.goto("/messages/c1");
    await expect(page.locator(".threadMessages .messageBubble")).toHaveCount(8);
    await expectNoHorizontalOverflow(page, NARROW.width);
    await expectComposerInView(page);
    await expectSendCentred(page);
    for (const selector of [".composerMobileAttach", ".composerVenueDesktop", ".threadBackLink"]) {
      const control = await box(page, selector);
      expect(control.width, `${selector} width`).toBeGreaterThanOrEqual(44);
      expect(control.height, `${selector} height`).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("the inbox on a phone", () => {
  test("is a list of faces, and an unread row says how many", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await installThread(page, fixture());
    await page.goto("/messages");
    const rows = page.locator(".conversationItem");
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator(".messageAvatar")).toHaveText("K");
    await expect(rows.first()).toHaveClass(/conversationItemUnread/);
    await expect(rows.first().locator(".conversationUnread")).toHaveText("2");
    await expect(rows.first().locator(".conversationTime")).toHaveText(/^\d+m$|^now$/);
    // Signed in, the courtesy line about needing an account is not restated.
    await expect(page.locator(".messagesCourtesyNote")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, PHONE.width);
  });
});

test.describe("the message thread on a desktop", () => {
  test("splits into two panes that scroll on their own, composer at the foot", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await installThread(page, fixture());
    await page.goto("/messages/c1");
    await expect(page.locator(".threadMessages .messageBubble")).toHaveCount(8);

    const split = await box(page, ".messagesSplit");
    expect(split.bottom).toBeLessThanOrEqual(DESKTOP.height);
    const dock = await box(page, ".composerDock");
    expect(dock.bottom).toBeLessThanOrEqual(split.bottom + 1);
    expect(dock.bottom).toBeGreaterThan(split.bottom - 4);

    // The list is its own scroller, opened at its newest row.
    const scrolled = await page.evaluate(() => {
      const list = document.querySelector(".threadMessages") as HTMLElement;
      return {
        overflowY: getComputedStyle(list).overflowY,
        atBottom: Math.abs(list.scrollTop + list.clientHeight - list.scrollHeight) <= 2,
      };
    });
    expect(scrolled.overflowY).toBe("auto");
    expect(scrolled.atBottom).toBe(true);
    await expectMessageInView(page, "Bring cash, card machine is dodgy");
    await expectSendCentred(page);
  });
});
