import { expect, test } from "@playwright/test";
import { ACCOUNTS, AUTH_STORAGE_KEY, readDeviceAccounts, readDeviceIdentity } from "./helpers/authDoubles";
import { ROBIN, FOX, fixture, capture, decoded, ready, shot, observeDisposal, observeInput, recordHitPoint, requireDeliveredInput, recordGestureEndCommand, requireEndedInput, evidence, portrait, host, canvas } from "./helpers/originalMeshAcceptance";

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block", colorScheme: "light", reducedMotion: "no-preference" });
test.beforeEach(async ({ page }) => { test.setTimeout(90_000); await page.clock.install(); });

for (const touch of [false, true]) {
  test.describe(touch ? "M1" : "D1", () => {
    test.use({ viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 900 }, hasTouch: touch, isMobile: touch });
    test(`${touch ? "M1 touch" : "D1 desktop"}: idle and frozen horizontal drag paint the original Robin`, async ({ page, hasTouch, isMobile, viewport }, info) => {
      const fx = await fixture(page, info.project.use.baseURL!); const seen = capture(page);
      await evidence(page, info, seen, fx, async () => {
        await page.goto("/pal");
        await observeInput(page, { hasTouch, isMobile, viewport });
        await ready(page, seen);
        await portrait(page).scrollIntoViewIfNeeded();
        await page.clock.pauseAt(await page.evaluate((timeout) => Date.now() + timeout, info.timeout));
        const idleA = await shot(page, info, "idle-a");
        await page.clock.runFor(300);
        const idleB = await shot(page, info, "idle-b");
        expect(idleB.equals(idleA), "Explicit idle RAF advances must change actual mesh pixels").toBe(false);
        const frozen = await shot(page, info, "frozen-a");
        expect((await shot(page, info, "frozen-control")).equals(frozen), "No-input frozen frames must match").toBe(true);
        await canvas(page).evaluate(node => { node.addEventListener("pointerdown", event => { (node as HTMLCanvasElement & { acceptancePointer?: string }).acceptancePointer = (event as PointerEvent).pointerType; }, { once: true }); });
        // Each drag gets the production 30 Hz draw interval. Home supplies
        // its neutral control at the same frozen timestamp as the rotated image.
        const compareAtCurrentTime = async (name: string, endGesture: () => Promise<unknown>) => {
          await page.clock.runFor(50);
          await requireDeliveredInput(page, touch ? "touch" : "mouse", name);
          const rotated = await shot(page, info, name + "-rotated");
          await recordGestureEndCommand(page, name);
          await endGesture();
          await requireEndedInput(page, touch ? "touch" : "mouse", name);
          await host(page).press("Home");
          const neutral = await shot(page, info, name + "-neutral");
          expect(rotated.equals(neutral), "Drag and neutral differ at the same pose timestamp").toBe(false);
          expect((await shot(page, info, name + "-neutral-control")).equals(neutral), "Two no-input neutral captures match at that timestamp").toBe(true);
        };
        for (const [name, dx] of [["drag-right", 30], ["drag-left", -30]] as const) {
          const box = await canvas(page).boundingBox(); if (!box) throw Error("Canvas geometry unavailable");
          const x = box.x + box.width / 2, y = box.y + box.height / 2;
          await recordHitPoint(page, x, y, name);
          if (touch) {
            const cdp = await page.context().newCDPSession(page);
            try {
              await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
              await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y, id: 1 }] });
              await compareAtCurrentTime(name, () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }));
            } finally { await cdp.detach(); }
          } else {
            await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y);
            await compareAtCurrentTime(name, () => page.mouse.up());
          }
        }
        expect(await canvas(page).evaluate(node => (node as HTMLCanvasElement & { acceptancePointer?: string }).acceptancePointer)).toBe(touch ? "touch" : "mouse");
      });
    });
  });
}

test.describe("F1", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("F1: an exact selected-model load failure retains usable original artwork", async ({ page }, info) => {
    const fx = await fixture(page, info.project.use.baseURL!); const seen = capture(page); const aborted: string[] = [];
    await page.route("**/brand/pals/" + ROBIN.file, async route => {
      if (new URL(route.request().frame().url()).pathname !== "/pal") { await route.continue(); return; }
      aborted.push(route.request().url()); await route.abort("failed");
    });
    await evidence(page, info, seen, fx, async () => {
      await page.goto("/pal"); await expect(page.getByRole("heading", { name: ROBIN.name, exact: true })).toBeVisible();
      await expect.poll(() => aborted.length).toBeGreaterThan(0);
      await expect.poll(() => seen.events.filter(x => x.event === "requestfailed").length).toBeGreaterThan(0);
      await expect(host(page)).toHaveAttribute("data-model-state", "model-unavailable");
      await decoded(page, true); await expect(canvas(page)).toHaveCount(0);
      await expect(host(page)).toHaveAttribute("aria-hidden", "true"); await expect(host(page)).not.toHaveAttribute("tabindex", "0");
      await expect(page.getByRole("button", { name: "Download my memories", exact: true })).toBeEnabled();
      await expect(page.getByRole("link", { name: "Plan with Robin", exact: true })).toBeVisible();
      expect(seen.models).toEqual([]);
    });
  });
});

test.describe("F2", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("F2: actual WebGL context loss restores the decoded original picture", async ({ page }, info) => {
    const fx = await fixture(page, info.project.use.baseURL!); const seen = capture(page);
    await evidence(page, info, seen, fx, async () => {
      await page.goto("/pal"); await ready(page, seen); await shot(page, info, "ready");
      const retained = await observeDisposal(page);
      const supported = await retained.evaluate(node => {
        const context = (node as HTMLCanvasElement).getContext("webgl2") ?? (node as HTMLCanvasElement).getContext("webgl");
        const extension = context?.getExtension("WEBGL_lose_context"); if (!extension) return false;
        extension.loseContext(); return true;
      });
      expect(supported, "UNSUPPORTED if WEBGL_lose_context is unavailable. This must not silently pass.").toBe(true);
      await expect.poll(() => retained.evaluate(node => (node as HTMLCanvasElement & { acceptanceContextLost?: boolean }).acceptanceContextLost)).toBe(true);
      await expect(host(page)).toHaveAttribute("data-model-state", "graphics-lost"); await decoded(page, true);
      await expect(canvas(page)).toBeHidden(); await expect(host(page)).toHaveAttribute("aria-hidden", "true");
      await retained.dispose();
    });
  });
});

test.describe("R1", () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  test("R1: reduced motion never starts a mesh and retires a later normal-motion mesh", async ({ page }, info) => {
    const fx = await fixture(page, info.project.use.baseURL!); const seen = capture(page);
    await evidence(page, info, seen, fx, async () => {
      await page.goto("/pal"); await expect(page.getByRole("heading", { name: ROBIN.name, exact: true })).toBeVisible();
      await decoded(page, true); await expect(canvas(page)).toHaveCount(0); expect(seen.requests).toHaveLength(0);
      await expect(host(page)).not.toHaveAttribute("tabindex", "0");
      await page.emulateMedia({ reducedMotion: "no-preference" }); await ready(page, seen); await shot(page, info, "normal");
      await page.emulateMedia({ reducedMotion: "reduce" }); await decoded(page, true); await expect(canvas(page)).toHaveCount(0);
      await expect(portrait(page).locator(".palPortrait")).not.toHaveAttribute("data-head-3d");
      const requests = seen.requests.length;
      await page.clock.pauseAt(await page.evaluate((timeout) => Date.now() + timeout, info.timeout)); await page.clock.runFor(500);
      await expect(canvas(page)).toHaveCount(0); expect(seen.requests.length).toBe(requests);
      expect(await portrait(page).locator(".palPortrait").evaluate(node => ["yaw", "pitch", "roll", "lean", "lift", "scale"].map(name => (node as HTMLElement).style.getPropertyValue("--pal-" + name)))).toEqual(["", "", "", "", "", ""]);
    });
  });
});

test.describe("O1", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("O1: the mounted account switch retires A before B's independent Pal resolves", async ({ page }, info) => {
    const fx = await fixture(page, info.project.use.baseURL!, true); const seen = capture(page);
    await evidence(page, info, seen, fx, async () => {
      await page.goto("/pal"); await ready(page, seen); await shot(page, info, "owner-a");
      const old = await observeDisposal(page); fx.holdB();
      await page.getByRole("button", { name: /Account options/ }).first().click();
      await expect(page.locator(".authAccountMenu")).toBeVisible();
      await page.getByRole("button", { name: "Switch account", exact: true }).click();
      const row = page.locator(".authSwitcherList .authSwitcherRow").filter({ hasText: "@" + ACCOUNTS.B.handle });
      await expect(row).toHaveCount(1); await row.click();
      await expect.poll(() => fx.ownerReads.includes(ACCOUNTS.B.id)).toBe(true);
      await expect(page.getByRole("img", { name: /Robin in 3D/ })).toHaveCount(0);
      await expect.poll(() => old.evaluate(node => node.isConnected)).toBe(false);
      await expect.poll(() => old.evaluate(node => (node as HTMLCanvasElement & { acceptanceContextLost?: boolean }).acceptanceContextLost)).toBe(true);
      await expect(portrait(page).locator("canvas")).toHaveCount(0);
      fx.releaseB(); await ready(page, seen, FOX);
      await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
      const session = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null") as { user?: { id?: string } } | null, AUTH_STORAGE_KEY);
      expect(session?.user?.id).toBe(ACCOUNTS.B.id);
      expect((await readDeviceAccounts(page)).some(x => x.userId === ACCOUNTS.B.id)).toBe(true);
      await expect(page.getByRole("heading", { name: FOX.name, exact: true })).toBeVisible();
      const storedPal = await page.evaluate(() => JSON.parse(localStorage.getItem("pubmax_pub_pal_v1") ?? "null") as { id?: string; ownerId?: string; name?: string; appearance?: { species?: string } } | null);
      expect(storedPal).toMatchObject({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ownerId: ACCOUNTS.B.id, name: "Fox", appearance: { species: "fox" } });
      expect(fx.ownerReads).toContain(ACCOUNTS.B.id);
      await expect(page.getByRole("img", { name: /Robin in 3D/ })).toHaveCount(0);
      // The mounted account menu is still open after switching. Dismiss it
      // through the product's supported Escape action before judging pixels.
      await page.keyboard.press("Escape");
      await expect(page.locator(".authAccountMenu")).toBeHidden();
      await canvas(page).scrollIntoViewIfNeeded();
      await expect.poll(() => canvas(page).evaluate(node => {
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit === node;
      }), { message: "The current fox canvas is unobscured at its centre" }).toBe(true);
      await shot(page, info, "owner-b"); await old.dispose();
    });
  });
});

test.describe("L1", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("L1: hidden late completion waits for visibility and route exit disposes the canvas", async ({ page }, info) => {
    const fx = await fixture(page, info.project.use.baseURL!); const seen = capture(page);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const delayed: import("@playwright/test").Request[] = [];
    const relayErrors: string[] = [];
    await page.route("**/brand/pals/" + ROBIN.file, async route => {
      delayed.push(route.request()); await gate;
      try { await route.continue(); } catch (error) { relayErrors.push(String(error)); }
    });
    try {
      await evidence(page, info, seen, fx, async () => {
        await page.goto("/pal"); await expect(page.getByRole("heading", { name: ROBIN.name, exact: true })).toBeVisible();
        await expect.poll(() => delayed.length).toBeGreaterThan(0);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect.poll(() => portrait(page).boundingBox().then(box => box ? box.y + box.height <= 0 || box.y >= 900 : false)).toBe(true);
        // Layout can move before the browser delivers its visibility update.
        // Deliver the held model only after the hidden-state precondition.
        await portrait(page).locator(".palPortrait").evaluate(frame => new Promise<void>(resolve => {
          const observer = new IntersectionObserver(([entry]) => {
            if (!entry || entry.isIntersecting) return;
            observer.disconnect();
            resolve();
          });
          observer.observe(frame);
        }));
        // Register completion before release. Do not accept an undelivered response.
        const target = delayed.at(-1)!;
        const outcome = target.failure() ? Promise.resolve("cancelled-or-failed" as const) : Promise.race([
          page.waitForEvent("requestfinished", { predicate: request => request === target }).then(() => "finished" as const),
          page.waitForEvent("requestfailed", { predicate: request => request === target }).then(() => "cancelled-or-failed" as const),
        ]);
        release();
        const delivered = await outcome;
        if (delivered !== "finished") {
          throw Error("L1 cancellation branch: " + String(target.failure()?.errorText) + ". Hidden completed-response acceptance remains unproved.");
        }
        await seen.settle();
        expect(relayErrors).toEqual([]); expect(seen.errors).toEqual([]);
        expect(seen.models.some(model => model.url.endsWith(ROBIN.file) && model.sha256 === ROBIN.sha), "Exact delayed model bytes completed before the hidden-state oracle").toBe(true);
        await expect(host(page)).not.toHaveAttribute("data-model-state", "ready");
        await portrait(page).scrollIntoViewIfNeeded(); await ready(page, seen); await expect(canvas(page)).toHaveCount(1); await shot(page, info, "returned");
        const old = await observeDisposal(page);
        await page.getByRole("link", { name: "Plan with Robin", exact: true }).click();
        await expect(page).not.toHaveURL(/\/pal$/);
        await expect.poll(() => old.evaluate(node => node.isConnected)).toBe(false);
        await expect.poll(() => old.evaluate(node => (node as HTMLCanvasElement & { acceptanceContextLost?: boolean }).acceptanceContextLost)).toBe(true);
        await old.dispose();
      });
    } finally { release(); }
  });
});
