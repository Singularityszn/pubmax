import { expect, test, type Locator, type Page } from "@playwright/test";

import { storeThemeChoice } from "./helpers/themeClock";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

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

for (const width of [390, 768, 1440]) for (const motion of ["no-preference", "reduce"] as const) {
  test(`photo selection press feedback uses one scale at ${width}px with ${motion} motion`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: motion });
    await storeThemeChoice(page, "light");
    await installThread(page, fixture());
    await page.goto("/messages/c1");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Photo caption");
    const send = page.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeEnabled();
    const resting = (await send.boundingBox())!;
    await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height / 2);
    await page.mouse.down();
    try {
      await send.evaluate(async button => {
        button.getBoundingClientRect();
        await Promise.all(button.getAnimations().map(animation => animation.finished));
      });
      const pressed = (await send.boundingBox())!;
      const scale = pressed.width / resting.width;
      await testInfo.attach("pressed scale", { body: JSON.stringify({ width, motion, scale }), contentType: "application/json" });
      const path = testInfo.outputPath(`${width}-${motion}-pressed.png`);
      await page.screenshot({ path });
      await testInfo.attach("pressed composer", { path, contentType: "image/png" });
      expect(scale).toBeCloseTo(motion === "reduce" ? 1 : 0.97, 3);
    } finally {
      await page.mouse.move(0, 0);
      await page.mouse.up();
    }
  });
}

test.describe("photo action and pinch regression", () => {
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await storeThemeChoice(page, "light");
    const sharp = (await import("sharp")).default;
    const photo = await sharp(Buffer.from('<svg width="800" height="800" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="800" fill="#d0a050"/><path d="M400 0V800M0 400H800" stroke="#111" stroke-width="20"/></svg>')).jpeg().toBuffer();
    const rows = [ME, THEM].map((senderHandle, index) => ({
      id: `photo-${index}`, conversationId: "c1", senderHandle, body: "", createdAt: new Date().toISOString(), read: true, flagged: false,
      attachment: { kind: "photo", url: `/api/messages/c1/media/photo-${index}`, width: 800, height: 800 },
    }));
    await installThread(page, rows);
    await page.route("**/api/messages/c1/media/**", route => route.fulfill({ contentType: "image/jpeg", body: photo }));
    await page.goto("/messages/c1");
    await expect(page.locator(".messagePhotoButton")).toHaveCount(2);
  });

  test("keyboard focus reveals photo message actions", async ({ page, browserName }) => {
    const opener = page.locator(".messagePhotoButton").first();
    await opener.focus();
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    const unsend = page.getByRole("button", { name: "Unsend", exact: true });
    await expect(unsend).toBeFocused();
    await expect(unsend).toBeInViewport();
    await expect(unsend.locator(".." )).toHaveCSS("opacity", "1");
  });

  test("photo viewer consumes shared native Escape and restores opener focus", async ({ page }) => {
    const opener = page.locator(".messagePhotoButton").first();
    await opener.tap();
    await expect(page.getByRole("dialog", { name: "Photo viewer" })).toBeVisible();
    const consumed = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(consumed).toBe(true);
    await expect(page.getByRole("dialog", { name: "Photo viewer" })).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("photo selection keeps touch actions and resisted pinch anchors", async ({ page, browserName }, testInfo) => {
    for (const [index, action] of ["Unsend", "Report"].entries()) {
      await page.locator(".composerInput").focus();
      const row = page.locator(".messageRow").nth(index);
      await row.locator(".messagePhotoButton").tap();
      await expect(page.getByRole("dialog", { name: "Photo viewer" })).toBeVisible();
      await page.getByRole("button", { name: "Zoom in", exact: true }).tap();
      await page.getByRole("button", { name: "Zoom in", exact: true }).tap();
      const stage = page.locator(".messagePhotoViewerStage");
      const image = page.locator(".messagePhotoViewerImage");
      const rect = await stage.boundingBox();
      if (!rect) throw new Error("Photo stage is missing");
      const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const cdp = browserName === "chromium" ? await page.context().newCDPSession(page) : null;
      if (!cdp) await stage.evaluate(element => { element.setPointerCapture = () => {}; });
      const pointer = async (type: "touchStart" | "touchMove" | "touchEnd", points: Array<{ id: number; x: number; y: number }>) => {
        if (cdp) await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
      };
      const synthetic = async (type: string, point: { id: number; x: number; y: number }) => {
        await stage.dispatchEvent(type, { pointerId: point.id, pointerType: "touch", clientX: point.x, clientY: point.y, button: 0, bubbles: true });
      };
      const fitted = Math.min(rect.width, rect.height);
      for (const direction of [1, -1]) {
        await page.getByRole("button", { name: "Reset zoom", exact: true }).tap();
        await page.getByRole("button", { name: "Zoom in", exact: true }).tap();
        await page.getByRole("button", { name: "Zoom in", exact: true }).tap();
        const start = { id: 1, x: direction === 1 ? rect.x + 20 : rect.x + rect.width - 20, y: centre.y - direction * 50 };
        const first = { id: 1, x: start.x + direction * (Math.max(0, (fitted * 2 - rect.width) / 2) + 100), y: start.y + direction * (Math.max(0, (fitted * 2 - rect.height) / 2) + 100) };
        if (cdp) { await pointer("touchStart", [start]); await pointer("touchMove", [first]); }
        else { await synthetic("pointerdown", start); await synthetic("pointermove", first); }
        const transform = () => image.evaluate(element => {
          const matrix = new DOMMatrix(getComputedStyle(element).transform);
          return { x: matrix.m41, y: matrix.m42 };
        });
        const before = await transform();
        const second = { id: 2, x: centre.x * 2 - first.x, y: centre.y * 2 - first.y };
        if (cdp) await pointer("touchStart", [first, second]);
        else await synthetic("pointerdown", second);
        const expand = (point: typeof first) => ({ id: point.id, x: centre.x + (point.x - centre.x) * 1.5, y: centre.y + (point.y - centre.y) * 1.5 });
        const expanded = [expand(first), expand(second)];
        if (cdp) await pointer("touchMove", expanded);
        else { await synthetic("pointermove", expanded[0]!); await synthetic("pointermove", expanded[1]!); }
        await expect(stage).toHaveAttribute("data-scale", "3");
        const after = await transform();
        expect(after.x).toBeCloseTo(before.x * 1.5, 1);
        expect(after.y).toBeCloseTo(before.y * 1.5, 1);
        const path = testInfo.outputPath(`${action}-${direction}-pinch.png`);
        await page.screenshot({ path });
        await testInfo.attach(`${action}-${direction}-pinch`, { path, contentType: "image/png" });
        if (cdp) await pointer("touchEnd", []);
        else { await synthetic("pointerup", expanded[0]!); await synthetic("pointerup", expanded[1]!); }
      }
      await cdp?.detach();
      await page.getByRole("button", { name: "Close", exact: true }).tap();
      await expect(row.locator(".messagePhotoButton")).toBeFocused();
      await expect(row).toHaveAttribute("data-revealed", "");
      await expect(row.locator(".messageMeta")).toHaveCSS("opacity", "1");
      await expect(row.getByRole("button", { name: action, exact: true })).toBeVisible();
      const path = testInfo.outputPath(`${action}-after-close.png`);
      await page.screenshot({ path });
      await testInfo.attach(`${action}-after-close`, { path, contentType: "image/png" });
    }
  });

  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`photo selection recovers from extreme travel with ${reducedMotion} motion`, async ({ page, browserName }, testInfo) => {
      await page.emulateMedia({ reducedMotion });
      await page.locator(".composerInput").focus();
      const opener = page.locator(".messagePhotoButton").last();
      await opener.tap();
      const stage = page.locator(".messagePhotoViewerStage");
      const image = page.locator(".messagePhotoViewerImage");
      await expect(page.getByRole("dialog", { name: "Photo viewer" })).toBeVisible();
      const rect = await stage.boundingBox();
      if (!rect) throw new Error("Photo stage is missing");
      const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const cdp = browserName === "chromium" ? await page.context().newCDPSession(page) : null;
      if (!cdp) {
        testInfo.annotations.push({ type: "coverage", description: "WebKit uses synthetic PointerEvents on the mounted viewer, not native device multi-touch." });
        await stage.evaluate(element => { element.setPointerCapture = () => {}; });
      }
      type Touch = { id: number; x: number; y: number };
      const pointer = async (type: "touchStart" | "touchMove" | "touchEnd", points: Touch[]) => {
        if (cdp) await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
        else for (const point of points) {
          await stage.dispatchEvent(type === "touchStart" ? "pointerdown" : type === "touchMove" ? "pointermove" : "pointerup", {
            pointerId: point.id, pointerType: "touch", clientX: point.x, clientY: point.y, button: 0, bubbles: true,
          });
        }
      };
      const transform = () => image.evaluate(element => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform);
        return { x: matrix.m41, y: matrix.m42, scale: matrix.a };
      });
      const shot = async (name: string) => {
        const path = testInfo.outputPath(`${name}.png`);
        await page.screenshot({ path });
        await testInfo.attach(name, { path, contentType: "image/png" });
      };
      const observations = [];
      for (const axis of ["x", "y"] as const) for (const direction of [1, -1]) {
        await page.getByRole("button", { name: "Reset zoom", exact: true }).tap();
        await page.getByRole("button", { name: "Zoom in", exact: true }).tap();
        await page.getByRole("button", { name: "Zoom in", exact: true }).tap();
        const dimension = axis === "x" ? rect.width : rect.height;
        const fitted = Math.min(rect.width, rect.height);
        const limit = Math.max(0, (fitted * 2 - dimension) / 2);
        const fingers = [{ id: 1, x: centre.x - 30, y: centre.y - 30 }, { id: 2, x: centre.x + 30, y: centre.y + 30 }];
        await pointer("touchStart", fingers);
        const travelled = fingers.map(point => ({ ...point, [axis]: point[axis] + direction * dimension * 3 }));
        await pointer("touchMove", travelled);
        await expect(stage).toHaveAttribute("data-scale", "2");
        await expect(async () => {
          const current = await transform();
          expect(direction * current[axis]).toBeGreaterThan(limit);
          expect(Math.abs(current[axis])).toBeLessThan((fitted * 2 + dimension) / 2);
        }).toPass();
        const extreme = await transform();
        await shot(`${axis}-${direction}-extreme`);
        await pointer("touchEnd", [travelled[1]!]);
        const handoff = await transform();
        expect(handoff.x).toBeCloseTo(extreme.x, 1);
        expect(handoff.y).toBeCloseTo(extreme.y, 1);
        const recovered = { ...travelled[0]!, [axis]: travelled[0]![axis] - direction * dimension / 4 };
        await pointer("touchMove", [recovered]);
        const otherAxis = axis === "x" ? "y" : "x";
        await expect(async () => {
          const current = await transform();
          expect(direction * (extreme[axis] - current[axis])).toBeGreaterThan(3);
          expect(direction * (extreme[axis] - current[axis])).toBeLessThan(dimension / 4);
          expect(current[otherAxis]).toBeCloseTo(extreme[otherAxis], 1);
        }).toPass();
        const dragged = await transform();
        await shot(`${axis}-${direction}-one-finger`);
        await pointer("touchEnd", cdp ? [] : [recovered]);
        const withinBounds = async () => {
          const current = await transform();
          expect(current.scale).toBe(2);
          expect(Math.abs(current.x)).toBeLessThanOrEqual(Math.max(0, (fitted * 2 - rect.width) / 2) + 0.1);
          expect(Math.abs(current.y)).toBeLessThanOrEqual(Math.max(0, (fitted * 2 - rect.height) / 2) + 0.1);
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          const next = await transform();
          expect(next.x).toBeCloseTo(current.x, 1);
          expect(next.y).toBeCloseTo(current.y, 1);
        };
        await expect(withinBounds).toPass();
        observations.push({ axis, direction, extreme, handoff, dragged, settled: await transform() });
        await shot(`${axis}-${direction}-settled`);
      }
      await cdp?.detach();
      await page.getByRole("button", { name: "Close", exact: true }).tap();
      await expect(opener).toBeFocused();
      await shot("close-focus");
      await opener.press("Enter");
      await expect(page.getByRole("dialog", { name: "Photo viewer" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Photo viewer" })).toHaveCount(0);
      await expect(opener).toBeFocused();
      await testInfo.attach("gesture-observations", { body: JSON.stringify({ browserName, reducedMotion, rect, observations }, null, 2), contentType: "application/json" });
    });
  }
});

/** Sign the page in as account A and answer the messages API in the browser. */
async function installThread(page: Page, rows: Row[], account: "A" | "B" = "A"): Promise<void> {
  const stub = await installAuthDoubles(page);
  await seedSignedIn(page, account);
  await stub.signedInAs(account);
  await page.addInitScript((handle) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax_handle", handle);
  }, ACCOUNTS[account].handle);
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

async function expectReadableCaption(field: Locator): Promise<void> {
  await expect(async () => {
    const geometry = await field.evaluate((element: HTMLTextAreaElement) => ({ height: element.clientHeight, required: element.scrollHeight, maxHeight: parseFloat(getComputedStyle(element).maxHeight) }));
    expect(geometry.height).toBeGreaterThanOrEqual(Math.min(geometry.required, geometry.maxHeight) - 1);
    expect(geometry.height).toBeLessThanOrEqual(geometry.maxHeight + 1);
    if (geometry.required > geometry.maxHeight) {
      const end = await field.evaluate((element: HTMLTextAreaElement) => { element.scrollTop = element.scrollHeight; return element.scrollTop + element.clientHeight; });
      expect(end).toBeGreaterThanOrEqual(geometry.required - 1);
    }
  }).toPass();
}

/** The composer dock is on screen, whole, and clear of the tab bar's pill. */
async function expectComposerInView(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await expect(page.locator(".composerDock")).toBeInViewport({ ratio: 1 });
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
  // The thread scrolls on the resize animation frame. Read current geometry
  // until that frame lands, keeping the same whole-bubble bounds.
  await expect.poll(async () => (await bubble.boundingBox())?.y ?? -1, {
    message: `${text}: top inside the viewport`,
  }).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => {
    const [bubbleBox, dock] = await Promise.all([bubble.boundingBox(), box(page, ".composerDock")]);
    return bubbleBox ? bubbleBox.y + bubbleBox.height - dock.top : Number.POSITIVE_INFINITY;
  }, { message: `${text}: sits above the composer` }).toBeLessThanOrEqual(1);
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

test.describe("message action hit areas", () => {
  for (const width of [390, 768, 1440]) {
    for (const rootFontPx of [16, 32]) {
      test(`actions stay in their own row at ${width}px with ${rootFontPx}px text`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        const rows = fixture().slice(-4).map((row, index) => ({
          ...row,
          senderHandle: index < 2 ? THEM : ME,
          body: index % 2 === 0 ? "Meet at the Coach and Horses, by the window." : "Ok",
          createdAt: new Date(Date.now() - (4 - index) * 1_000).toISOString(),
        }));
        await installThread(page, rows);
        await page.goto("/messages/c1");
        const bubbles = page.locator(".threadMessages .messageBubble");
        await expect(bubbles).toHaveCount(4);
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = `${size}px`;
        }, rootFontPx);
        await page.evaluate(() => document.fonts.ready);

        for (const index of [1, 3]) {
          const row = page.locator(".messageRow").nth(index);
          const bubble = bubbles.nth(index);
          const action = row.getByRole("button", { name: index === 1 ? "Report" : "Unsend", exact: true });
          await page.mouse.move(0, 0);
          await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
          const before = await bubbles.evaluateAll((elements) => elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          }));
          await bubble.hover();
          await expect(row.locator(".messageMeta")).toHaveCSS("opacity", "1");
          const geometry = await action.evaluate((element) => {
            const row = element.closest(".messageRow")!;
            const previous = row.previousElementSibling!.querySelector(".messageBubble")!;
            const bounds = element.getBoundingClientRect();
            const rowBounds = row.getBoundingClientRect();
            const previousBounds = previous.getBoundingClientRect();
            const x = bounds.left + bounds.width / 2;
            return {
              height: bounds.height,
              width: bounds.width,
              contained: bounds.top >= rowBounds.top && bounds.bottom <= rowBounds.bottom
                && bounds.left >= rowBounds.left && bounds.right <= rowBounds.right,
              previousCoversX: x > previousBounds.left && x < previousBounds.right,
              previousOwnsEdge: previous.contains(document.elementFromPoint(x, previousBounds.bottom - 1)),
            };
          });
          expect(geometry.height).toBeGreaterThanOrEqual(44);
          expect(geometry.width).toBeGreaterThanOrEqual(44);
          expect(geometry.contained).toBe(true);
          expect(geometry.previousCoversX).toBe(true);
          expect(geometry.previousOwnsEdge).toBe(true);
          const target = await action.boundingBox();
          await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2);
          await expect(row.locator(".messageMeta")).toHaveCSS("opacity", "1");
          expect(await bubbles.evaluateAll((elements) => elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          }))).toEqual(before);
          await page.screenshot({ path: testInfo.outputPath(`action-${index}.png`) });
          await page.mouse.move(0, 0);
          await action.focus();
          await expect(action).toBeFocused();
          await expect(row.locator(".messageMeta")).toHaveCSS("opacity", "1");
          await action.evaluate((element) => (element as HTMLElement).blur());
        }
      });
    }
  }
});

test.describe("message bubbles on touch", () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const width of [390, 768, 1440]) {
    for (const rootFontPx of [16, 32]) {
      test(`short bubbles keep their natural width at ${width}px with ${rootFontPx}px text`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await installThread(page, fixture().slice(4, 6).map((row) => ({ ...row, body: "Ok" })));
        await page.goto("/messages/c1");
        const bubbles = page.locator(".messageBubble");
        await expect(bubbles).toHaveText(["Ok", "Ok"]);
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = `${size}px`;
        }, rootFontPx);
        await page.evaluate(() => document.fonts.ready);
        for (const index of [0, 1]) {
          const bubble = bubbles.nth(index);
          const row = page.locator(".messageRow").nth(index);
          // A short text bubble needs only its text, padding and border, even if
          // its hidden action line is wider. This oracle does not use flex sizing.
          const naturalWidth = await bubble.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const style = getComputedStyle(element);
            return range.getBoundingClientRect().width + parseFloat(style.paddingLeft)
              + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth)
              + parseFloat(style.borderRightWidth);
          });
          const before = await bubble.boundingBox();
          await page.screenshot({ path: testInfo.outputPath(`short-${index}-before.png`) });
          expect(Math.abs(before!.width - naturalWidth)).toBeLessThanOrEqual(1);
          await bubble.tap();
          await expect(row.locator(".messageMeta")).toHaveCSS("opacity", "1");
          const after = await bubble.boundingBox();
          expect(after!.width).toBe(before!.width);
          expect(after!.x).toBe(before!.x);
          if (index === 0) {
            const meta = await row.locator(".messageMeta").boundingBox();
            expect(after!.width).toBeLessThan(meta!.width);
          }
          await page.screenshot({ path: testInfo.outputPath(`short-${index}-after.png`) });
        }
      });
    }
  }
});

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

    // No floating compose control sits over Send: it left with the five-tab
    // dock (captain, 1 Nov 2026).
    await expect(page.locator(".createFabRoot")).toHaveCount(0);
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

  // verify-preview-4 RED 1 (5 Sep 2026): a first-time reader's first thread,
  // with the analytics consent card unset (every new account), opened with the
  // newest bubble under the head (y -26 to 34) and the composer floating at
  // y 532 over 268px of nothing. The body reserves the card's lane, the page
  // gains that much scroll, opening scrolls to the foot, and the rows sat at
  // the TOP of the thread's tall flex child. The rows hug the composer now and
  // the composer clears the card as well as the bar.
  for (const viewport of [PHONE, NARROW]) {
    test(`a first-run reader's one-message thread opens on the message and the composer, above the consent card @${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await installThread(page, [fixture()[6]!]);
      await page.addInitScript(() => {
        window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
        window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
      });
      await page.goto("/messages/c1");
      await expect(page.locator(".threadMessages .messageBubble")).toHaveCount(1);
      const card = page.getByLabel("Anonymous analytics choice");
      await expect(card).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: testInfo.outputPath(`thread-first-run-${viewport.width}x${viewport.height}.png`) });

      await expectComposerInView(page);
      await expectMessageInView(page, "Sound, see you at the Lamb at 7");
      // The head is not over the bubble either.
      const [bubble, head] = await Promise.all([
        page.locator(".messageBubble").first().boundingBox(),
        box(page, ".threadHeader"),
      ]);
      expect(bubble!.y).toBeGreaterThanOrEqual(head.bottom - 1);
      // The composer sits above the card, never under it.
      const [dock, cardBox] = await Promise.all([box(page, ".composerDock"), card.boundingBox()]);
      expect(dock.bottom).toBeLessThanOrEqual(cardBox!.y + 1);

      await card.getByRole("button", { name: "No thanks" }).click();
      await expect(card).toBeHidden();
      await expectComposerInView(page);
      await expectMessageInView(page, "Sound, see you at the Lamb at 7");
    });
  }

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
  test("composer growth stays bounded and attachment targets stay touch-safe", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await installThread(page, fixture());
    await page.goto("/messages/c1");
    const field = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(field).toBeVisible();
    await field.fill(Array.from({ length: 20 }, () => "One more line").join("\n"));
    const measured = await field.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      rootFont: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(measured.height).toBeGreaterThanOrEqual(44);
    expect(measured.height).toBeLessThanOrEqual(9 * measured.rootFont);
    expect(measured.scrollHeight).toBeGreaterThan(measured.clientHeight);
    await expect(page.locator(".composerPhotoDesktop")).toBeHidden();
    await page.getByRole("button", { name: "Add an attachment", exact: true }).click();
    const chooser = page.getByRole("dialog", { name: "Add to message" });
    await expect(chooser).toBeVisible();
    for (const target of await chooser.locator(".messageAttachTarget").all()) {
      const geometry = await target.boundingBox();
      expect(geometry!.width).toBeGreaterThanOrEqual(56);
      expect(geometry!.height).toBeGreaterThanOrEqual(56);
      await expect(target).toHaveCSS("touch-action", "manipulation");
      await expect(target).toHaveCSS("user-select", "none");
    }
  });

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
  test("filters conversations and starts a pub plan without sending it", async ({ page }, testInfo) => {
    await page.setViewportSize(PHONE);
    await installThread(page, fixture());
    const now = new Date().toISOString();
    await page.route("**/api/messages?**", (route) => route.fulfill({ json: { conversations: [
      { id: "c1", otherHandle: THEM, lastBody: "Meet outside at seven?", lastAt: now, unread: 2 },
      { id: "c2", kind: "group", title: "Friday regulars", otherHandle: "tom", memberHandles: [ME, "tom", "maisie"], lastBody: "I can make the first stop", lastAt: now, lastFromMe: true, unread: 0 },
      { id: "c4", otherHandle: "tom_the_lamb", lastAt: now, unread: 0 },
    ] } }));
    await page.route("**/api/messages/c2**", (route) => route.fulfill({ json: {
      conversation: { kind: "group", members: [ME, "tom", "maisie"], title: "Friday regulars" },
      messages: [
        { id: "group-1", conversationId: "c2", senderHandle: "tom", body: "The Harp at seven?", createdAt: now, read: true, flagged: false },
        { id: "group-2", conversationId: "c2", senderHandle: "maisie", body: "See you there", createdAt: now, read: true, flagged: false },
      ],
    } }));
    await page.goto("/messages");
    await expect(page.locator(".conversationLink")).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath("inbox-390.png") });
    await page.getByRole("button", { name: "Unread", exact: true }).click();
    await expect(page.locator(".conversationLink")).toHaveCount(1);
    await page.getByRole("button", { name: "Groups", exact: true }).click();
    await expect(page.locator(".conversationLink")).toHaveCount(1);
    await page.getByRole("link", { name: /Friday regulars/ }).click();
    await expect(page.locator(".messageSender")).toHaveText(["@tom", "@maisie"]);
    await page.screenshot({ path: testInfo.outputPath("group-390.png") });
    await page.goto("/messages/c4");
    const starters = page.getByRole("group", { name: "Start the conversation" });
    await expect(starters).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("empty-thread-390.png") });
    await starters.getByRole("button", { name: "Share a pub", exact: true }).click();
    await expect(page.getByRole("searchbox", { name: "Search pubs", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await starters.getByRole("button", { name: "Share a plan", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Which plan?", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(".messageBubble")).toHaveCount(0);
    await page.setViewportSize(NARROW);
    await expectComposerInView(page);
    await expectNoHorizontalOverflow(page, NARROW.width);
    await page.setViewportSize(DESKTOP);
    await page.goto("/messages");
    await expect(page.locator(".conversationLink")).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath("inbox-1440.png") });
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await page.screenshot({ path: testInfo.outputPath("inbox-dark-1440.png") });
  });

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
    // Signed in, the inbox is a list of people, not the signed-out empty state.
    await expect(page.locator(".messagesScreen--signedOut")).toHaveCount(0);
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

  test("the consent card never lands on the desktop composer", async ({ page }, testInfo) => {
    // verify-preview-4, 7.2 at 1440: the fixed-height split kept its
    // viewport-sized box while the body reserved the card's lane under it,
    // so the card sat on the composer row. The panel gives the lane back.
    await page.setViewportSize(DESKTOP);
    await installThread(page, fixture());
    await page.addInitScript(() => {
      window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
      window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
    });
    await page.goto("/messages/c1");
    await expect(page.locator(".threadMessages .messageBubble")).toHaveCount(8);
    const card = page.getByLabel("Anonymous analytics choice");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath("thread-first-run-1440x900.png") });

    const [dock, cardBox, split] = await Promise.all([
      box(page, ".composerDock"),
      card.boundingBox(),
      box(page, ".messagesSplit"),
    ]);
    expect(split.bottom).toBeLessThanOrEqual(cardBox!.y + 1);
    expect(dock.bottom).toBeLessThanOrEqual(cardBox!.y + 1);
    await expectComposerInView(page);
    await expectMessageInView(page, "Bring cash, card machine is dodgy");
  });
});

for (const width of [390, 768, 1440]) {
  test(`photo history loads nearby frames and keyboard destinations at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await storeThemeChoice(page, "light");
    const sharp = (await import("sharp")).default;
    const bytes = await sharp("public/landing/hero-thames.jpg").resize(2048, 1536, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: `history-${index}`, conversationId: "c1", senderHandle: THEM, body: "", createdAt: new Date(Date.now() - (40 - index) * 60_000).toISOString(), read: true, flagged: false,
      attachment: { kind: "photo", url: `/api/messages/c1/media/history-${index}`, width: 2048, height: 1536 },
    }));
    const requests: string[] = [];
    await installThread(page, rows);
    await page.route("**/api/messages/c1/media/**", async route => {
      requests.push(new URL(route.request().url()).pathname);
      await route.fulfill({ contentType: "image/jpeg", body: bytes });
    });
    await page.goto("/messages/c1");
    const frames = page.locator(".messagePhotoFigure");
    await expect(frames).toHaveCount(40);
    await expect(frames.last().locator(".messagePhotoButton")).toBeVisible();
    await expect(frames.nth(20).locator(".messagePhotoPending")).toHaveCount(1);
    expect(requests).not.toContain("/api/messages/c1/media/history-20");
    expect(requests.length).toBeLessThanOrEqual(12);
    const initial = { requests: requests.length, bytes: requests.length * bytes.length, totalFixtureBytes: 40 * bytes.length };
    await page.screenshot({ path: testInfo.outputPath("history-initial.png") });
    const before = await frames.nth(20).boundingBox();
    await frames.nth(20).scrollIntoViewIfNeeded();
    const opener = frames.nth(20).locator(".messagePhotoButton");
    await expect(opener).toBeVisible();
    await expect(opener).toBeInViewport();
    expect(requests).toContain("/api/messages/c1/media/history-20");
    expect((await frames.nth(20).boundingBox())!.height).toBeCloseTo(before!.height, 1);
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Photo viewer" })).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(opener).toBeFocused();
    await frames.first().scrollIntoViewIfNeeded();
    await expect(frames.first().locator(".messagePhotoButton")).toBeVisible();
    expect(requests).toContain("/api/messages/c1/media/history-0");
    expect(requests.length).toBeLessThan(40);
    await page.screenshot({ path: testInfo.outputPath("history-older.png") });
    await testInfo.attach("historical media requests", { body: JSON.stringify({ width, initial, afterScroll: { requests: requests.length, bytes: requests.length * bytes.length }, bytesPerPhoto: bytes.length }), contentType: "application/json" });
  });
}

test("photo selection reports a twelve-photo batch from native file paths", async ({ page }, testInfo) => {
  const { writeFile } = await import("node:fs/promises");
  const sharp = (await import("sharp")).default;
  const bytes = await sharp("public/landing/hero-thames.jpg").resize(4032, 3024, { fit: "cover" }).jpeg({ quality: 94 }).toBuffer();
  const paths = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const path = testInfo.outputPath(`camera-${index}.jpg`);
    await writeFile(path, bytes);
    return path;
  }));
  await page.setViewportSize(PHONE);
  await storeThemeChoice(page, "light");
  await installThread(page, fixture());
  await page.goto("/messages/c1");
  await expect(page.locator(".composerInput")).toBeVisible();
  await page.evaluate(() => {
    const samples: Array<{ completed: number; total: number; previews: number; editable: boolean; cancel: boolean }> = [];
    (window as unknown as { preparationSamples: typeof samples }).preparationSamples = samples;
    const dock = document.querySelector(".composerDock")!;
    const observer = new MutationObserver(() => {
      const progress = dock.querySelector('[role="progressbar"][aria-label="Photo preparation"]');
      if (!progress) return;
      samples.push({ completed: Number(progress.getAttribute("aria-valuenow")), total: Number(progress.getAttribute("aria-valuemax")), previews: dock.querySelectorAll(".composerPendingThumb").length, editable: !dock.querySelector<HTMLTextAreaElement>(".composerInput")!.disabled, cancel: !!dock.querySelector(".composerPreparing button") });
    });
    observer.observe(dock, { childList: true, subtree: true, attributes: true });
  });
  await page.locator("#message-photo-file").setInputFiles(paths);
  await expect(page.locator(".composerPendingThumb")).toHaveCount(12);
  const samples = await page.evaluate(() => (window as unknown as { preparationSamples: Array<{ completed: number; total: number; previews: number; editable: boolean; cancel: boolean }> }).preparationSamples);
  expect(samples.some(sample => sample.completed > 0 && sample.completed < 12)).toBe(true);
  expect(samples.every(sample => sample.total === 12 && sample.previews === 0 && sample.editable && sample.cancel)).toBe(true);
  expect(samples.map(sample => sample.completed)).toEqual(samples.map(sample => sample.completed).sort((a, b) => a - b));
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await testInfo.attach("preparation progress", { body: JSON.stringify({ samples, inputBytes: bytes.length, dimensions: [4032, 3024], source: "upscaled project photograph" }), contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath("twelve-photos-prepared.png") });
});

test("an older poll preserves acknowledged photos until stored bytes decode", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await storeThemeChoice(page, "light");
  const rows = fixture();
  await installThread(page, rows);
  const sharp = (await import("sharp")).default;
  const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#d0a050" } }).jpeg().toBuffer();
  let holdRead = false;
  let releaseRead!: () => void;
  const media: Array<() => void> = [];
  let sent = 0;
  await page.route("**/api/messages/c1**", async route => {
    if (new URL(route.request().url()).pathname.includes("/media/")) {
      await new Promise<void>(resolve => { media.push(resolve); });
      await route.fulfill({ contentType: "image/jpeg", body: bytes });
    } else if (route.request().method() === "POST") {
      const message = {
        id: `saved-photo-${sent++}`, conversationId: "c1", senderHandle: ME, body: "", createdAt: new Date().toISOString(), read: false, flagged: false,
        attachment: { kind: "photo", url: `/api/messages/c1/media/saved-${sent}`, width: 1200, height: 800 },
      };
      rows.push(message);
      await route.fulfill({ json: { message } });
    } else {
      const snapshot = [...rows];
      if (holdRead) {
        holdRead = false;
        await new Promise<void>(resolve => { releaseRead = resolve; });
      }
      await route.fulfill({ json: { messages: snapshot } });
    }
  });
  await page.goto("/messages/c1");
  await expect(page.locator(".composerInput")).toBeVisible();
  holdRead = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(() => expect(releaseRead).toBeDefined()).toPass();
  await page.locator("#message-photo-file").setInputFiles([1, 2].map(index => ({ name: `photo-${index}.jpg`, mimeType: "image/jpeg", buffer: bytes })));
  await expect(page.locator(".composerPendingThumb")).toHaveCount(2);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const photos = page.locator(".messagePhotoButton .messagePhoto");
  await expect(photos).toHaveCount(2);
  await expect(() => expect(media).toHaveLength(2)).toPass();
  const previews = await photos.evaluateAll(images => images.map(image => image.getAttribute("src")));
  const stale = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/messages/c1");
  releaseRead();
  await stale;
  await expect(photos).toHaveCount(2);
  await expect(async () => expect(await photos.evaluateAll(images => images.map(image => image.getAttribute("src")))).toEqual(previews)).toPass();
  await expect(page.locator(".messagePhotoPending")).toHaveCount(0);
  const path = testInfo.outputPath("delayed-poll-previews.png");
  await page.screenshot({ path });
  await testInfo.attach("previews after the older poll", { path, contentType: "image/png" });
  for (const release of media) release();
  await expect(async () => expect(await photos.evaluateAll(images => images.map(image => image.getAttribute("src")))).not.toEqual(previews)).toPass();
  await expect(photos).toHaveCount(2);
});

for (const pointer of ["coarse", "fine"] as const) test.describe(`photo frame with ${pointer} pointer`, () => {
  test.use({ hasTouch: pointer === "coarse", isMobile: pointer === "coarse" });

for (const width of [390, 768, 1440]) for (const native of [false, true]) {
  for (const size of [{ width: 128, height: 2048 }, { width: 2048, height: 128 }]) {
    for (const largeText of [false, true]) {
      test(`photo selection frame stays stable at ${width}px, ${size.width}x${size.height}, native ${native}, large text ${largeText}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(({ native, largeText }) => {
          const apply = () => {
            if (!document.documentElement) return false;
            document.documentElement.toggleAttribute("data-native-shell", native);
            document.documentElement.style.fontSize = largeText ? "32px" : "16px";
            return true;
          };
          if (!apply()) {
            const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
            observer.observe(document, { childList: true });
          }
        }, { native, largeText });
        await page.emulateMedia({ reducedMotion: largeText ? "reduce" : "no-preference" });
        await storeThemeChoice(page, largeText ? "dark" : "light");
        const rows = fixture();
        await installThread(page, rows);
        const sharp = (await import("sharp")).default;
        const bytes = await sharp({ create: { ...size, channels: 3, background: "#d0a050" } }).jpeg().toBuffer();
        let releaseSend!: () => void;
        let releaseMedia!: (result: "request-error" | "decode-error" | "success") => void;
        let mediaRequests = 0;
        await page.route("**/api/messages/c1**", async route => {
          if (new URL(route.request().url()).pathname.includes("/media/")) {
            mediaRequests++;
            const result = await new Promise<"request-error" | "decode-error" | "success">(resolve => { releaseMedia = resolve; });
            if (result === "request-error") await route.fulfill({ status: 503, body: "Unavailable" });
            else await route.fulfill({ contentType: "image/jpeg", body: result === "success" ? bytes : Buffer.from("broken image") });
            return;
          }
          if (route.request().method() !== "POST") {
            await route.fulfill({ json: { messages: rows } });
            return;
          }
          await new Promise<void>(resolve => { releaseSend = resolve; });
          const message = {
            id: "extreme-photo", conversationId: "c1", senderHandle: ME, body: "", createdAt: new Date().toISOString(), read: false, flagged: false,
            attachment: { kind: "photo", url: "/api/messages/c1/media/extreme-photo", ...size },
          };
          rows.push(message);
          await route.fulfill({ json: { message } });
        });
        await page.goto("/messages/c1");
        await expect(page.locator(".composerInput")).toBeVisible();
        const configureFrame = () => page.evaluate(({ native, largeText }) => {
          document.documentElement.toggleAttribute("data-native-shell", native);
          document.documentElement.style.fontSize = largeText ? "32px" : "16px";
        }, { native, largeText });
        await configureFrame();
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(pointer === "coarse");
        const frame = page.locator(".messagePhotoFigure");
        const photo = frame.locator(".messagePhoto");
        const opener = frame.locator(".messagePhotoButton");
        const retry = frame.getByRole("button", { name: "Retry photo", exact: true });
        const geometry = async () => frame.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const image = element.querySelector<HTMLImageElement>(".messagePhoto")!;
          const box = image.getBoundingClientRect();
          const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
          return {
            width: rect.width, height: rect.height,
            paintX: box.x - rect.x + (box.width - image.naturalWidth * scale) / 2,
            paintY: box.y - rect.y + (box.height - image.naturalHeight * scale) / 2,
            paintWidth: image.naturalWidth * scale, paintHeight: image.naturalHeight * scale,
          };
        });
        const shot = async (step: string) => {
          const path = testInfo.outputPath(`${step}.png`);
          await page.screenshot({ path });
          await testInfo.attach(step, { path, contentType: "image/png" });
        };
        await page.locator("#message-photo-file").setInputFiles({ name: "extreme.jpg", mimeType: "image/jpeg", buffer: bytes });
        await expect(page.locator(".composerPendingThumb")).toBeVisible();
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(page.locator(".messagePhotoSending")).toBeVisible();
        await expect(photo).toHaveJSProperty("naturalWidth", size.width);
        const original = await geometry();
        expect(original.width).toBeGreaterThanOrEqual(44);
        expect(original.height).toBeGreaterThanOrEqual(44);
        expect(original.height).toBeLessThanOrEqual(240);
        expect(original.paintWidth / original.paintHeight).toBeCloseTo(size.width / size.height, 4);
        await shot("optimistic");
        await expect(() => expect(releaseSend).toBeDefined()).toPass();
        releaseSend();
        await expect(opener).toBeVisible();
        await expect(() => expect(mediaRequests).toBe(1)).toPass();
        const localUrl = await photo.getAttribute("src");
        const stable = async () => {
          const current = await geometry();
          for (const key of Object.keys(original) as Array<keyof typeof original>) expect(current[key]).toBeCloseTo(original[key], 1);
          expect(await photo.evaluate(image => getComputedStyle(image).objectFit)).toBe("contain");
          expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
          const target = (await opener.boundingBox())!;
          expect(target.width).toBeGreaterThanOrEqual(44);
          expect(target.height).toBeGreaterThanOrEqual(44);
        };
        await stable();
        for (const [index, result] of (["request-error", "decode-error"] as const).entries()) {
          releaseMedia(result);
          await expect(retry).toBeVisible();
          expect(await photo.getAttribute("src")).toBe(localUrl);
          await stable();
          const retryBox = (await retry.boundingBox())!;
          const frameBox = (await frame.boundingBox())!;
          expect(retryBox.width).toBeGreaterThanOrEqual(44);
          expect(retryBox.height).toBeGreaterThanOrEqual(44);
          expect(retryBox.x).toBeGreaterThanOrEqual(frameBox.x);
          expect(retryBox.y).toBeGreaterThanOrEqual(frameBox.y);
          expect(retryBox.x + retryBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
          expect(retryBox.y + retryBox.height).toBeLessThanOrEqual(frameBox.y + frameBox.height + 1);
          expect(await retry.evaluate(button => button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight)).toBe(true);
          await shot(result);
          await opener.click({ position: { x: 2, y: frameBox.height - 2 } });
          await expect(page.getByRole("dialog", { name: "Photo viewer" })).toBeVisible();
          await page.getByRole("button", { name: "Close", exact: true }).click();
          await expect(opener).toBeFocused();
          await retry.click();
          await expect(() => expect(mediaRequests).toBe(index + 2)).toPass();
          await stable();
        }
        releaseMedia("success");
        await expect(photo).not.toHaveAttribute("src", localUrl!);
        await expect(photo).toHaveJSProperty("naturalWidth", size.width);
        await expect(retry).toHaveCount(0);
        await stable();
        await shot("stored");
        await page.reload();
        await configureFrame();
        await expect(frame.locator(".messagePhotoPending")).toBeVisible();
        const reserved = (await frame.boundingBox())!;
        expect(reserved.width).toBeCloseTo(original.width, 1);
        expect(reserved.height).toBeCloseTo(original.height, 1);
        await expect(() => expect(mediaRequests).toBe(4)).toPass();
        releaseMedia("request-error");
        await expect(retry).toBeVisible();
        expect(await photo.count()).toBe(0);
        const failed = (await frame.boundingBox())!;
        expect(failed.width).toBeCloseTo(reserved.width, 1);
        expect(failed.height).toBeCloseTo(reserved.height, 1);
        await shot("remote-only-error");
        await retry.click();
        await expect(() => expect(mediaRequests).toBe(5)).toPass();
        releaseMedia("success");
        await expect(opener).toBeVisible();
        await stable();
        await expectNoHorizontalOverflow(page, width);
      });
    }
  }
}

});

for (const width of [390, 768, 1440]) for (const theme of ["light", "dark"] as const) {
  test(`photo drafts stay neutral and captions resize live at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    const resizeErrors: string[] = [];
    page.on("pageerror", error => { if (error.message.includes("ResizeObserver")) resizeErrors.push(error.message); });
    await page.setViewportSize({ width, height: 900 });
    await installThread(page, fixture());
    await storeThemeChoice(page, theme);
    let sends = 0;
    page.on("request", request => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/messages/c1") sends += 1;
    });
    const sharp = (await import("sharp")).default;
    const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#d0a050" } }).jpeg().toBuffer();
    await page.goto("/messages/c1");
    await page.locator("#message-photo-file").setInputFiles({ name: "draft.jpg", mimeType: "image/jpeg", buffer: photo });
    await expect(page.locator(".composerPendingThumb")).toBeVisible();
    const field = page.getByRole("textbox", { name: "Message", exact: true });
    const caption = "The full photo with a caption that wraps onto several lines.";
    await field.fill(caption);
    for (const visit of [1, 2]) {
      const inbox = width >= 1024
        ? page.getByRole("navigation", { name: "Site navigation" }).getByRole("link", { name: /^Messages/ })
        : page.getByRole("link", { name: "Back to inbox", exact: true });
      await inbox.click();
      await expect(page).toHaveURL(/\/messages$/);
      const notice = page.locator(".messagePhotoRecoveryNotice");
      const link = page.getByRole("link", { name: "Return to your photos", exact: true });
      await expect(link).toBeVisible();
      expect(await link.evaluate(element => getComputedStyle(element).color)).toBe(await notice.evaluate(element => getComputedStyle(element).color));
      await page.screenshot({ path: testInfo.outputPath(`${width}-${theme}-recovery-${visit}.png`) });
      await link.click();
      await expect(page).toHaveURL(/\/messages\/c1$/);
      await expect(page.locator(".composerPendingThumb")).toBeVisible();
      await expect(field).toHaveValue(caption);
      await expect(page.locator(".threadError")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Retry send", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    }
    expect(sends).toBe(0);
    for (const text of ["", "The full photo.", caption]) {
      await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });
      await field.fill(text);
      await expectReadableCaption(field);
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await expectReadableCaption(field);
      await expect(field).toHaveValue(text);
      const dock = (await page.locator(".composerDock").boundingBox())!;
      expect(dock.y).toBeGreaterThanOrEqual(0);
      expect(dock.y + dock.height).toBeLessThanOrEqual(900);
      await expectNoHorizontalOverflow(page, width);
      expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
      await page.screenshot({ path: testInfo.outputPath(`${width}-${theme}-${text ? "caption" : "empty"}-large-text.png`) });
    }
    await page.setViewportSize({ width: width === 390 ? 768 : 390, height: 900 });
    await expectReadableCaption(field);
    await expect(field).toHaveValue(caption);
    await page.setViewportSize({ width, height: 900 });
    await field.fill("A long caption that must scroll. ".repeat(20));
    const overflow = await field.evaluate(element => {
      element.scrollTop = element.scrollHeight;
      return { height: element.clientHeight, required: element.scrollHeight, maxHeight: parseFloat(getComputedStyle(element).maxHeight), scroll: element.scrollTop };
    });
    expect(overflow.height).toBeLessThanOrEqual(overflow.maxHeight + 1);
    expect(overflow.required).toBeGreaterThan(overflow.height);
    expect(overflow.scroll).toBeGreaterThan(0);
    expect(resizeErrors).toEqual([]);
  });
}

test.describe("compact photo composer", () => {
  test.use({ isMobile: false });

  for (const width of [390, 768, 1440]) for (const theme of ["light", "dark"] as const) for (const keyboard of width === 390 ? [false, true] : [false]) {
    test(`photo selection controls remain reachable with large text at ${width}px in ${theme}${keyboard ? " with a keyboard inset" : ""}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await storeThemeChoice(page, theme);
      await installThread(page, fixture());
      let sends = 0;
      await page.route("**/api/messages/c1", async route => {
        const request = route.request();
        if (request.method() === "POST" && request.headers()["content-type"]?.includes("multipart/form-data")) {
          sends += 1;
          await route.fulfill({ status: 503, json: { error: "Upload interrupted. Try again." } });
        } else await route.fallback();
      });
      const sharp = (await import("sharp")).default;
      const photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#d0a050" } }).jpeg().toBuffer();
      await page.goto("/messages/c1");
      await page.locator("#message-photo-file").setInputFiles({ name: "compact.jpg", mimeType: "image/jpeg", buffer: photo });
      await expect(page.locator(".composerPendingThumb")).toBeVisible();
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      const field = page.getByRole("textbox", { name: "Message", exact: true });
      const caption = "A photo caption for a small viewport with large accessible text.";
      await field.fill(caption);
      await page.setViewportSize({ width, height: 480 });
      if (keyboard) {
        await field.focus();
        await page.evaluate(() => {
          const viewport = window.visualViewport!;
          Object.defineProperties(viewport, {
            height: { configurable: true, get: () => 220 },
            offsetTop: { configurable: true, get: () => 0 },
          });
          viewport.dispatchEvent(new Event("resize"));
        });
        await expect(page.locator(".messageThreadShell")).toHaveAttribute("data-keyboard-open", "");
        await expect(page.locator(".messageThreadShell")).toHaveCSS("--keyboard-inset", "260px");
      }
      await expectReadableCaption(field);

      const reachable = async (control: Locator) => {
        await expect(async () => {
          const dock = page.locator(".composerDock");
          const box = await dock.boundingBox();
          expect(box).not.toBeNull();
          const header = (await page.locator(".threadHeader").boundingBox())!;
          const visual = await page.evaluate(() => ({
            top: window.visualViewport?.offsetTop ?? 0,
            bottom: (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? innerHeight),
          }));
          const top = Math.max(80, visual.top, header.y + header.height, box!.y);
          const bottom = Math.min(460, visual.bottom, box!.y + box!.height);
          expect(bottom).toBeGreaterThan(top);
          expect(box!.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
          expect(box!.y + box!.height).toBeLessThanOrEqual(visual.bottom + 1);
          expect(await dock.evaluate(element => {
            const style = getComputedStyle(element);
            return element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
          })).toBeGreaterThanOrEqual(44);
          await page.mouse.move(box!.x + 4, (top + bottom) / 2);
          const target = await control.boundingBox();
          expect(target).not.toBeNull();
          await page.mouse.wheel(0, target!.y + target!.height / 2 - (top + bottom) / 2);
          await expect(control).toBeInViewport({ ratio: 0.99 });
          const visible = (await control.boundingBox())!;
          expect(visible.width).toBeGreaterThanOrEqual(44);
          expect(visible.height).toBeGreaterThanOrEqual(44);
          expect(visible.y).toBeGreaterThanOrEqual(top - 1);
          expect(visible.y + visible.height).toBeLessThanOrEqual(bottom + 1);
          expect(await control.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
          })).toBe(true);
        }).toPass();
      };
      await reachable(page.getByRole("button", { name: "Remove", exact: true }));
      const send = page.getByRole("button", { name: "Send", exact: true });
      await reachable(send);
      await page.screenshot({ path: testInfo.outputPath(`${width}-${theme}-compact-send.png`) });
      await send.click();
      const retry = page.getByRole("button", { name: "Retry send", exact: true });
      await expect(retry).toBeEnabled();
      if (keyboard) await field.focus();
      await reachable(retry);
      await page.screenshot({ path: testInfo.outputPath(`${width}-${theme}-compact-retry.png`) });
      expect(sends).toBe(1);
      await expect(field).toHaveValue(caption);
      expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
      await expectNoHorizontalOverflow(page, width);
    });
  }
});

for (const width of [390, 768, 1440]) for (const photoCount of [1, 2]) {
  test(`photo selection (${photoCount}), interrupted send and viewer keep page scale at 1 at ${width}px`, async ({ page, browser, browserName }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const rows = fixture();
    await installThread(page, rows);
    await storeThemeChoice(page, "light");
    const sharp = (await import("sharp")).default;
    const original = await sharp({ create: { width: 1800, height: 900, channels: 3, background: "#d0a050" } }).withMetadata({ orientation: photoCount === 1 ? 6 : 1 }).jpeg().toBuffer();
    const fixedPhoto = await sharp(original).rotate().jpeg().toBuffer();
    const files = new Map<string, Buffer>();
    let release!: () => void;
    let rejectNext = true;
    const requests: Array<{ key: string; body: string; photo: Buffer }> = [];
    let holdMedia = true;
    const releaseMedia: Array<() => void> = [];
    await page.route("**/api/messages/c1**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes("/media/")) {
        if (holdMedia) await new Promise<void>(resolve => { releaseMedia.push(resolve); });
        await route.fulfill({ contentType: "image/jpeg", body: files.get(url.pathname)! });
        return;
      }
      if (route.request().method() !== "POST") {
        await route.fulfill({ json: { messages: rows } }); return;
      }
      // WebKit omits multipart File bytes from its interception protocol.
      // It checks geometry and scale against fixed server-shaped responses.
      let post = { body: requests.length < 2 ? "The full photo" : "", clientMessageId: "webkit-fixture" };
      let bytes = fixedPhoto;
      if (browserName === "chromium") {
        const data = await new Request(url, { method: "POST", headers: { "content-type": route.request().headers()["content-type"]! }, body: new Uint8Array(route.request().postDataBuffer()!) }).formData();
        post = JSON.parse(String(data.get("post")));
        bytes = Buffer.from(await (data.get("photo") as File).arrayBuffer());
      }
      requests.push({ key: post.clientMessageId, body: post.body, photo: bytes });
      await new Promise<void>(resolve => { release = resolve; });
      if (rejectNext) { rejectNext = false; await route.fulfill({ status: 503, json: { error: "Upload interrupted. Try again." } }); return; }
      const id = `m${rows.length + 1}`;
      const path = `/api/messages/c1/media/${id}`;
      files.set(path, bytes);
      const metadata = await sharp(bytes).metadata();
      const message = { id, conversationId: "c1", senderHandle: ME, body: post.body, createdAt: new Date().toISOString(), read: false, flagged: false,
        attachment: { kind: "photo", url: path, width: metadata.width!, height: metadata.height! } };
      rows.push(message);
      await route.fulfill({ json: { message } });
    });
    const shot = async (step: string) => {
      const path = testInfo.outputPath(`${width}-${step}.png`);
      await page.screenshot({ path });
      await testInfo.attach(step, { path, contentType: "image/png" });
    };
    const scaleIsOne = async () => expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    const readable = async (selector: string, count: number) => {
      await expect(page.locator(selector)).toHaveCount(count);
      await expect(async () => expect(await page.locator(selector).evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)).toPass();
    };
    await page.goto("/messages/c1");
    await expect(page.locator(".composerInput")).toBeVisible();
    expect(parseFloat(await page.locator(".composerInput").evaluate(element => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await page.locator(".composerInput").focus(); await scaleIsOne();
    await shot("before-attach"); await scaleIsOne();
    await page.locator("#message-photo-file").setInputFiles(Array.from({ length: photoCount }, (_, index) => ({ name: `photo-${index}.jpg`, mimeType: "image/jpeg", buffer: original })));
    await readable(".composerPendingThumb", photoCount);
    await expect(page.getByRole("dialog", { name: "Crop photo" })).toHaveCount(0);
    await shot("attached"); await scaleIsOne();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("The full photo");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("progressbar", { name: "Sending photo" })).toBeVisible();
    await readable(".messagePhotoSending", photoCount);
    await shot("sending"); await scaleIsOne();
    await expect(async () => expect(requests).toHaveLength(1)).toPass();
    if (photoCount === 2 && width === 390) {
      await page.getByRole("link", { name: "Back to inbox", exact: true }).click();
      await expect(page).toHaveURL(/\/messages$/);
      await expect(page.getByRole("link", { name: "Return to your photos", exact: true })).toBeVisible();
      await shot("paused-in-inbox");
      release();
      await page.getByRole("link", { name: "Return to your photos", exact: true }).click();
      await expect(page).toHaveURL(/\/messages\/c1$/);
      await readable(".composerPendingThumb", photoCount);
      await page.getByRole("link", { name: "Back to inbox", exact: true }).click();
      await expect(page.getByRole("link", { name: "Return to your photos", exact: true })).toBeVisible();
      await shot("paused-after-second-leave");
      await page.getByRole("link", { name: "Return to your photos", exact: true }).click();
    } else release();
    const resumedUncertainSend = photoCount === 2 && width === 390;
    const resend = page.getByRole("button", { name: resumedUncertainSend ? "Send" : "Retry send", exact: true });
    await expect(resend).toBeEnabled();
    if (resumedUncertainSend) {
      await expect(page.locator(".threadError")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Retry send" })).toHaveCount(0);
    }
    if (photoCount === 1 && width === 390) {
      await page.getByRole("link", { name: "Back to inbox", exact: true }).click();
      await expect(page.getByRole("link", { name: "Return to your photos", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Return to your photos", exact: true }).click();
      await expect(page.getByRole("button", { name: "Retry send" })).toBeEnabled();
    }
    await readable(".composerPendingThumb", photoCount);
    await shot("failed-retry"); await scaleIsOne();
    await resend.click();
    await expect(async () => expect(requests).toHaveLength(2)).toPass();
    if (browserName === "chromium") expect(requests[1]!.key).toBe(requests[0]!.key);
    release();
    if (photoCount > 1) { await expect(async () => expect(requests).toHaveLength(3)).toPass(); release(); }
    await expect(page.locator("[data-sending]")).toHaveCount(0);
    await readable(".messagePhotoButton .messagePhoto", photoCount);
    await expect(page.locator(".messagePhotoPending")).toHaveCount(0);
    const reserved = await page.locator(".messagePhotoFigure").evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect(); return { width: box.width, height: box.height };
    }));
    await shot("loading-photos"); await scaleIsOne();
    const localUrls = await page.locator(".messagePhotoButton .messagePhoto").evaluateAll(images => images.map(image => image.getAttribute("src")));
    holdMedia = false; releaseMedia.forEach(resolve => resolve());
    await expect(async () => {
      const storedUrls = await page.locator(".messagePhotoButton .messagePhoto").evaluateAll(images => images.map(image => image.getAttribute("src")));
      expect(storedUrls).toHaveLength(photoCount);
      expect(storedUrls.every(url => !localUrls.includes(url))).toBe(true);
    }).toPass();
    await readable(".messagePhotoButton .messagePhoto", photoCount);
    const loaded = await page.locator(".messagePhotoFigure").evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect(); return { width: box.width, height: box.height };
    }));
    expect(loaded).toEqual(reserved);
    if (browserName === "chromium") {
      expect(requests.map(request => request.body)).toEqual(photoCount > 1 ? ["The full photo", "The full photo", ""] : ["The full photo", "The full photo"]);
      const uploaded = await sharp(requests[1]!.photo).metadata();
      expect(uploaded.width! / uploaded.height!).toBe(photoCount === 1 ? 0.5 : 2);
      expect(uploaded.orientation).toBeUndefined();
    }
    await expect(page.locator("[data-sending]")).toHaveCount(0);
    await shot("sent-light"); await scaleIsOne();
    await page.getByRole("button", { name: "Switch to dark theme", exact: true }).click();
    await expect(page.getByRole("button", { name: "Switch to light theme", exact: true })).toBeVisible();
    await shot("sent-dark");
    await page.locator(".messagePhotoButton").first().click();
    await expect(page.getByRole("dialog", { name: "Photo viewer" })).toBeVisible();
    expect(await page.locator(".messagePhotoViewer").boundingBox()).toEqual({ x: 0, y: 0, width, height: 900 });
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(page.locator(".messagePhotoViewerStage")).toHaveAttribute("data-scale", "1.5");
    if (browserName === "chromium") {
      const bounds = await page.locator(".messagePhotoViewerStage").boundingBox();
      const x = bounds!.x + bounds!.width / 2;
      const y = bounds!.y + bounds!.height / 2;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: x - 30, y }, { id: 2, x: x + 30, y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: x - 60, y }, { id: 2, x: x + 60, y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(async () => expect(Number(await page.locator(".messagePhotoViewerStage").getAttribute("data-scale"))).toBeGreaterThan(1.5)).toPass();
      await cdp.detach();
    }
    await shot("viewer-zoom"); await scaleIsOne();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Photo viewer" })).toHaveCount(0);
    await expect(page.locator(".messagePhotoButton").first()).toBeFocused();
    await scaleIsOne();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const caption of ["", "The full photo.", "The full photo with a caption that wraps onto several lines."]) {
      await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });
      await page.getByRole("textbox", { name: "Message", exact: true }).fill(caption);
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      const field = page.getByRole("textbox", { name: "Message", exact: true });
      await expect(field).toHaveValue(caption);
      await expectReadableCaption(field);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const dock = await page.locator(".composerDock").boundingBox();
      expect(dock!.y).toBeGreaterThanOrEqual(0);
      expect(dock!.y + dock!.height).toBeLessThanOrEqual(900);
      await shot(`large-text-${caption ? "caption" : "empty"}-reduced-motion`);
    }

    const recipientContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height: 900 }, serviceWorkers: "block" });
    const recipient = await recipientContext.newPage();
    await installThread(recipient, rows, "B");
    await recipient.route("**/api/messages/c1/media/**", route => route.fulfill({ contentType: "image/jpeg", body: files.get(new URL(route.request().url()).pathname)! }));
    await recipient.goto("/messages/c1");
    await expect(recipient.locator(".messagePhotoButton")).toHaveCount(photoCount);
    await expect(async () => expect(await recipient.locator(".messagePhoto").evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)).toPass();
    const received = testInfo.outputPath(`${width}-recipient.png`);
    await recipient.screenshot({ path: received }); await testInfo.attach("recipient", { path: received, contentType: "image/png" });
    await recipientContext.close();
  });
}

test.describe("thread keyboard geometry", () => {
  for (const layout of [
    { width: 390, shell: "web" }, { width: 768, shell: "web" }, { width: 1440, shell: "web" },
    { width: 390, shell: "ios" }, { width: 390, shell: "android" },
  ]) {
    const { width, shell } = layout;
    for (const theme of ["dark", "light"] as const) {
      test(`group thread keyboard dock at ${width} in ${theme} on ${shell}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        await page.clock.setFixedTime(new Date("2026-11-16T14:00:00Z"));
        if (shell !== "web") {
          await page.addInitScript((platform) => {
            Object.defineProperty(window, "Capacitor", {
              configurable: true,
              value: Object.defineProperties({}, {
                isNativePlatform: { get: () => () => true, set: () => {} },
                getPlatform: { get: () => () => platform, set: () => {} },
              }),
            });
            window.localStorage.setItem("pubmax:nativeFirstRun:routed:v1", "1");
          }, shell);
          await page.emulateMedia({ reducedMotion: "reduce" });
        }
        await storeThemeChoice(page, theme);
        await page.addInitScript(() => {
          let height: number | undefined;
          Object.defineProperties(window.visualViewport!, {
            height: { configurable: true, get: () => height ?? window.innerHeight, set: (next: number) => { height = next; } },
            offsetTop: { configurable: true, writable: true, value: 0 },
          });
        });
        const rows = fixture().slice(-3);
        await installThread(page, rows);
        await page.route("**/api/messages/c1**", async (route, request) => {
          if (request.method() === "POST") return route.fallback();
          await route.fulfill({ json: {
            messages: rows,
            conversation: { kind: "group", members: [ME, THEM, "maisie"], title: "Friday regulars" },
          } });
        });
        await page.goto("/messages/c1");
        const field = page.getByRole("textbox", { name: "Message", exact: true });
        await expect(field).toBeVisible();
        await expect(page.getByText("Friday regulars", { exact: true })).toBeVisible();
        if (shell !== "web") await expect(page.locator("html")).toHaveAttribute("data-native-shell", shell);
        const pageScroll = await page.evaluate(() => window.scrollY);
        await (testInfo.project.use.hasTouch ? field.tap() : field.click());
        if (width < 1024) {
          if (shell === "android") await page.setViewportSize({ width, height: 500 });
          await page.evaluate(() => {
            Object.assign(window.visualViewport!, { height: 500 });
            window.visualViewport!.dispatchEvent(new Event("resize"));
            const dock = document.querySelector(".composerDock")!.getBoundingClientRect();
            if (Math.abs(dock.bottom - 500) > 1) throw new Error(`Immediate keyboard geometry: ${JSON.stringify({
              gap: 500 - dock.bottom, scale: window.visualViewport!.scale,
              shellBottom: document.querySelector(".messageThreadShell")!.getBoundingClientRect().bottom,
              shellHeight: getComputedStyle(document.querySelector(".messageThreadShell")!).height,
              transition: getComputedStyle(document.querySelector(".messageThreadShell")!).transition,
              listHeight: document.querySelector(".threadMessages")!.getBoundingClientRect().height,
              listTransition: getComputedStyle(document.querySelector(".threadMessages")!).transition,
              animations: document.querySelector(".messageThreadShell")!.getAnimations().map(animation => animation.effect?.getTiming()),
              height: window.visualViewport!.height, layoutHeight: window.innerHeight,
              style: document.querySelector(".messageThreadShell")!.getAttribute("style"),
              keyboard: document.querySelector(".messageThreadShell")!.hasAttribute("data-keyboard-open"),
              reduced: document.querySelector(".messageThreadShell")!.hasAttribute("data-viewport-reduced"),
            })}`);
          });
          await expect(page.locator(".messageThreadShell")).toHaveAttribute("data-keyboard-open", "");
        }
        await expect(async () => {
          const geometry = await page.evaluate(() => {
            const dock = document.querySelector(".composerDock")!.getBoundingClientRect();
            const header = document.querySelector(".threadHeader")!.getBoundingClientRect();
            const day = document.querySelector(".threadDay")!.getBoundingClientRect();
            return {
              gap: window.visualViewport!.height + window.visualViewport!.offsetTop - dock.bottom,
              dateClearance: day.top - header.bottom,
              scale: window.visualViewport!.scale,
            };
          });
          if (width < 1024) {
            expect(Math.abs(geometry.gap), "dock meets the visible viewport foot").toBeLessThanOrEqual(1);
          } else {
            await expectComposerInView(page);
          }
          expect(geometry.dateClearance, "Today clears the header").toBeGreaterThanOrEqual(0);
          expect(geometry.scale).toBe(1);
        }).toPass();
        await expectMessageInView(page, "Bring cash, card machine is dodgy");
        expect(await field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
        await page.screenshot({
          path: testInfo.outputPath(`keyboard-${width}-${theme}.png`), scale: "css",
          ...(width < 1024 ? { clip: { x: 0, y: 0, width, height: 500 } } : {}),
        });
        if (width < 1024) {
          const panned = await page.evaluate(() => {
            Object.assign(window.visualViewport!, { height: 380, offsetTop: 120 });
            window.visualViewport!.dispatchEvent(new Event("scroll"));
            return {
              header: document.querySelector(".threadHeader")!.getBoundingClientRect().top,
              dock: document.querySelector(".composerDock")!.getBoundingClientRect().bottom,
            };
          });
          expect(panned.header).toBe(120);
          expect(Math.abs(panned.dock - 500)).toBeLessThanOrEqual(1);
          await page.evaluate(() => {
            Object.assign(window.visualViewport!, { height: 500, offsetTop: 0 });
            window.visualViewport!.dispatchEvent(new Event("scroll"));
          });
        }
        await field.fill("See you there");
        const send = page.getByRole("button", { name: "Send", exact: true });
        await (testInfo.project.use.hasTouch ? send.tap() : send.click());
        await expectMessageInView(page, "See you there");
        await expect(field).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
        expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
        if (width < 1024) {
          await field.blur();
          await expect(page.locator(".messageThreadShell")).not.toHaveAttribute("data-keyboard-open", "");
          await expect(async () => {
            expect(Math.abs((await box(page, ".composerDock")).bottom - 500)).toBeLessThanOrEqual(1);
          }).toPass();
          if (shell === "android") await page.setViewportSize({ width, height: 844 });
          await page.evaluate(() => {
            Object.assign(window.visualViewport!, { height: 844, offsetTop: 0 });
            window.visualViewport!.dispatchEvent(new Event("resize"));
          });
          await expect(page.locator(".messageThreadShell")).not.toHaveAttribute("data-keyboard-open", "");
          await expectMessageInView(page, "See you there");
        }
      });
    }
  }
});


for (const width of [390, 1440]) {
  test(`thread keyboard geometry preserves the reader's position while the field grows at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const rows = Array.from({ length: 60 }, (_, index) => ({
      ...fixture()[0], id: `history-${index}`, body: `Earlier message ${index}`,
    }));
    await installThread(page, rows);
    await page.goto("/messages/c1");
    const list = page.locator(".threadMessages");
    await expect(list.locator(".messageBubble")).toHaveCount(60);
    await expectMessageInView(page, "Earlier message 59");
    const original = await list.evaluate((element) => new Promise<{ top: number; height: number }>((resolve) => {
      element.addEventListener("scroll", () => resolve({ top: element.scrollTop, height: element.clientHeight }), { once: true });
      element.scrollTop = element.scrollHeight - element.clientHeight - 500;
    }));
    const field = page.getByRole("textbox", { name: "Message", exact: true });
    await field.fill("First line\nSecond line\nThird line\nFourth line");
    await expect(async () => {
      expect(await list.evaluate((element) => element.clientHeight)).toBeLessThan(original.height);
    }).toPass();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await list.evaluate((element) => element.scrollTop)).toBe(original.top);
    await list.evaluate((element) => new Promise<void>((resolve) => {
      element.addEventListener("scroll", () => resolve(), { once: true });
      element.scrollTop = element.scrollHeight;
    }));
    await field.fill("Short");
    await expectMessageInView(page, "Earlier message 59");
    await field.fill("First line\nSecond line\nThird line\nFourth line");
    await expectMessageInView(page, "Earlier message 59");
  });
}


test.describe("thread keyboard geometry on a large touch screen", () => {
  test.use({ hasTouch: true });
  test("keeps the composer above a landscape tablet keyboard", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.addInitScript(() => {
      let height: number | undefined;
      Object.defineProperties(window.visualViewport!, {
        height: { configurable: true, get: () => height ?? innerHeight, set: (value: number) => { height = value; } },
        offsetTop: { configurable: true, writable: true, value: 0 },
      });
    });
    await installThread(page, fixture());
    await page.goto("/messages/c1");
    await expect(page.locator(".messagesInboxPane")).toBeVisible();
    await expect(page.locator(".siteNavBar")).toBeVisible();
    await page.getByRole("textbox", { name: "Message", exact: true }).tap();
    const geometry = await page.evaluate(() => {
      Object.assign(window.visualViewport!, { height: 400, offsetTop: 120 });
      window.visualViewport!.dispatchEvent(new Event("resize"));
      window.visualViewport!.dispatchEvent(new Event("scroll"));
      return {
        top: document.querySelector(".threadHeader")!.getBoundingClientRect().top,
        bottom: document.querySelector(".composerDock")!.getBoundingClientRect().bottom,
        panelTop: document.querySelector(".messagesSplit")!.getBoundingClientRect().top,
        gutter: document.querySelector(".messageBubble")!.getBoundingClientRect().left
          - document.querySelector(".messagesThreadPane")!.getBoundingClientRect().left,
      };
    });
    expect(geometry.panelTop).toBe(120);
    expect(geometry.top).toBe(121);
    expect(Math.abs(geometry.bottom - 520)).toBeLessThanOrEqual(1);
    expect(geometry.gutter).toBeGreaterThanOrEqual(20);
    await expect(page.locator(".messagesInboxPane")).toBeVisible();
    await expectMessageInView(page, "Bring cash, card machine is dodgy");
    await page.screenshot({ path: testInfo.outputPath("tablet-touch-keyboard.png"), scale: "css", clip: { x: 0, y: 120, width: 1180, height: 400 } });
  });
});


test("thread keyboard geometry reserves the newest photo before its bytes arrive", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const rows = [...fixture(), {
    ...fixture()[0], id: "delayed-photo", senderHandle: ME, body: "Latest photo",
    attachment: { kind: "photo" as const, url: "/api/messages/c1/photo-delayed", width: 600, height: 600 },
  }];
  await installThread(page, rows);
  let releasePhoto!: () => void;
  const ready = new Promise<void>((resolve) => { releasePhoto = resolve; });
  await page.route("**/api/messages/c1/photo-delayed?**", async (route) => {
    await ready;
    await route.fulfill({ path: `${process.cwd()}/e2e/fixtures/bill.jpg`, contentType: "image/jpeg" });
  });
  await page.goto("/messages/c1");
  await expect(page.getByText("Loading photo", { exact: true })).toBeVisible();
  await expectMessageInView(page, "Latest photo");
  const before = await page.locator(".messagePhotoFigure").boundingBox();
  releasePhoto();
  const photo = page.getByRole("img", { name: /Photo/ });
  await expect(photo).toBeVisible();
  await photo.evaluate((element: HTMLImageElement) => element.decode());
  const after = await page.locator(".messagePhotoFigure").boundingBox();
  expect(after!.height).toBe(before!.height);
  await expectMessageInView(page, "Latest photo");
});
