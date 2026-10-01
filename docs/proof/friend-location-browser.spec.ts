import { chromium, expect, test as baseTest, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FRIEND_LOCATION_POLL_MS } from "../../lib/friendLocation";
import { UI_UX_CHROMIUM_ARGS } from "../../scripts/lib/uiUxBattleTestBrowser.mjs";
import { ACCOUNTS, installAuthDoubles, readDeviceIdentity } from "../../e2e/helpers/authDoubles";
import { installFriendLocationBrowserDoubles, installNativeFriendWatchTrace, readNativeFriendWatchTrace } from "../../e2e/helpers/friendLocationBrowser";

const test = baseTest.extend({
  context: [async ({ baseURL }, runFixture) => {
    if (!baseURL || new URL(baseURL).hostname !== "localhost") throw new Error("Native friend proof requires localhost.");
    const profile = await mkdtemp(join(tmpdir(), "pubmaxx-friends-native-"));
    const native = spawn(chromium.executablePath(), [
      ...UI_UX_CHROMIUM_ARGS, "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore" });
    let launchError: Error | undefined;
    const exited = new Promise<void>((resolve) => {
      native.once("exit", () => resolve());
      native.once("error", (error) => { launchError = error; resolve(); });
    });
    let browser: Browser | undefined;
    try {
      let port = "";
      await expect.poll(async () => {
        if (launchError) throw launchError;
        if (native.exitCode !== null || native.signalCode !== null) throw new Error("Owned native Chromium exited before CDP was ready.");
        port = await readFile(join(profile, "DevToolsActivePort"), "utf8").then((value) => value.split("\n")[0] ?? "").catch(() => "");
        return port;
      }, { timeout: 15_000 }).toMatch(/^\d+$/);
      // The default context is essential: newContext enables focus emulation.
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true, timeout: 15_000 });
      const context = browser.contexts()[0];
      if (!context) throw new Error("Owned native Chromium has no default context.");
      // Same registration boundary used by Playwright serviceWorkers: "block".
      // A fresh profile has no existing workers; native visibility is untouched.
      await context.addInitScript("if (navigator.serviceWorker) navigator.serviceWorker.register = async () => { console.warn('Service Worker registration blocked by Playwright'); };");
      await runFixture(context);
    } finally {
      if (native.pid !== undefined && native.exitCode === null && native.signalCode === null) {
        native.kill("SIGTERM");
        await Promise.race([exited, delay(5_000)]);
        if (native.exitCode === null && native.signalCode === null) {
          native.kill("SIGKILL");
          await Promise.race([exited, delay(5_000).then(() => { throw new Error("Owned native Chromium did not exit."); })]);
        }
      }
      await browser?.close().catch(() => {});
      await rm(profile, { recursive: true, force: true });
    }
  }, { scope: "test", timeout: 45_000 }],
});

test.use({
  headless: false, viewport: { width: 1440, height: 900 }, serviceWorkers: "block",
  launchOptions: { args: [...UI_UX_CHROMIUM_ARGS] }, trace: "off", video: "off",
});

type Fixture = Awaited<ReturnType<typeof installFriendLocationBrowserDoubles>>;
type WatchBaseline = { patchRequests: number; watchTaggedPatches: number };

async function attachEvidence(page: Page, fixture: Fixture, checkpoint: string, sameWindow?: boolean): Promise<void> {
  const trace = await readNativeFriendWatchTrace(page);
  const panel = page.getByRole("region", { name: "Friend locations" });
  const statusNode = panel.getByRole("status");
  const status = await statusNode.count() ? await statusNode.textContent() : null;
  const knownStatus = ["Sharing with selected mates.", "Updates paused while this page is hidden.", "Choose who can see you.", "Location updates stopped. Stop sharing, then start again.", "Locations could not be checked. Try again."];
  const receipt = {
    checkpoint, syntheticPositionsOnly: true,
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    origin: new URL(page.url()).origin,
    visibility: await page.evaluate(() => document.visibilityState),
    permission: await page.evaluate(() => navigator.permissions.query({ name: "geolocation" }).then((permission) => permission.state)),
    browserSetup: {
      connection: "CDP with noDefaults in a fresh per-test default context",
      serviceWorkerBoundary: "registration blocked by Playwright-equivalent init script",
      registeredServiceWorkers: await page.evaluate(async () => "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0),
      viewport: page.viewportSize(),
      sameWindow,
    },
    nativeWatch: {
      activeIds: trace.active,
      events: trace.events.map((event) => ({ kind: event.kind, id: event.id, source: event.source, state: event.state, errorCode: event.errorCode, errorName: event.errorName, status: event.status })),
    },
    updateDiagnostics: {
      patchRequests: fixture.calls.filter((call) => call.method === "PATCH").length,
      completedPatchRequests: fixture.calls.filter((call) => call.method === "PATCH" && call.completed).length,
      watchTaggedPatches: trace.events.filter((event) => event.kind === "patch" && event.source === "friend-watch").length,
      otherTaggedPatches: trace.events.filter((event) => event.kind === "patch" && event.source === "other").length,
      watchCallbacks: trace.events.filter((event) => event.kind === "callback").length,
      nativeWatchErrors: trace.events.filter((event) => event.kind === "error").length,
      nativeCurrentErrors: trace.events.filter((event) => event.kind === "current-error").length,
    },
    requests: fixture.calls.map((call) => ({
      method: call.method, completed: call.completed,
      hasCoordinateFields: Boolean(call.body && "latitude" in call.body && "longitude" in call.body),
      accuracyAtLeast110: typeof call.body?.accuracy === "number" ? call.body.accuracy >= 110 : null,
      recipientsCount: Array.isArray(call.body?.recipients) ? call.body.recipients.length : null,
    })),
    publicState: {
      status: status && knownStatus.includes(status) ? status : null,
      markers: await page.locator(".friendLocationMarker").count(),
      friendRows: await panel.locator("li").count(),
      sharingBadges: await page.locator(".friendLocationSharingBadge").count(),
      signInDoors: await panel.getByRole("link", { name: "Sign in", exact: true }).count(),
      deviceHandleCleared: (await readDeviceIdentity(page)).handle === null,
    },
  };
  const receiptPath = test.info().outputPath(`${checkpoint}.json`);
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  await test.info().attach(`${checkpoint} receipt`, { path: receiptPath, contentType: "application/json" });
  const screenshotPath = test.info().outputPath(`${checkpoint}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await test.info().attach(`${checkpoint} screenshot`, { path: screenshotPath, contentType: "image/png" });
}

async function prepareOwner(page: Page, context: BrowserContext) {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  expect(new URL(origin).hostname).toBe("localhost");
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.grantPermissions(["geolocation"], { origin });
  await context.setGeolocation({ latitude: 51.512345, longitude: -0.123456, accuracy: 12 });
  await installNativeFriendWatchTrace(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
  const auth = await installAuthDoubles(page);
  const fixture = await installFriendLocationBrowserDoubles(page);
  await page.goto(`${origin}/today`);
  await auth.signedInAs("A");
  await page.goto(`${origin}/map`);
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => navigator.permissions.query({ name: "geolocation" }).then((permission) => permission.state))).toBe("granted");
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("visible");
  await expect.poll(() => page.evaluate(async () => "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0)).toBe(0);
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await expect(async () => {
    await page.getByRole("button", { name: "Friend locations", exact: true }).click();
    await expect(page.getByRole("region", { name: "Friend locations" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  const panel = page.getByRole("region", { name: "Friend locations" });
  await panel.getByRole("checkbox", { name: ACCOUNTS.B.handle, exact: true }).check();
  let watchBaseline: WatchBaseline;
  fixture.holdStartPosts();
  try {
    await panel.getByRole("button", { name: "Share my location", exact: true }).click();
    await expect.poll(() => fixture.pendingStartPosts()).toBe(1);
    const trace = await readNativeFriendWatchTrace(page);
    expect(trace.active).toEqual([]);
    watchBaseline = {
      patchRequests: fixture.calls.filter((call) => call.method === "PATCH").length,
      watchTaggedPatches: trace.events.filter((event) => event.kind === "patch" && event.source === "friend-watch").length,
    };
    expect(watchBaseline).toEqual({ patchRequests: 0, watchTaggedPatches: 0 });
    // Chromium 153 flushes a pending watch with error 2 on override replacement.
    // Move the synthetic provider before the server authorises the native watch.
    await context.setGeolocation({ latitude: 51.514234, longitude: -0.126456, accuracy: 12 });
  } finally { fixture.releaseStartPosts(); }
  await expect(panel.getByRole("status")).toHaveText("Sharing with selected mates.");
  await expect(page.locator(".friendLocationMarker")).toHaveCount(1);
  const start = fixture.calls.find((call) => call.method === "POST");
  expect(start?.body).toMatchObject({ recipients: [ACCOUNTS.B.id], latitude: 51.512, longitude: -0.123 });
  expect(Number(start?.body?.accuracy)).toBeGreaterThanOrEqual(110);
  return { auth, fixture, panel, watchBaseline };
}

async function proveWorkingWatch(page: Page, fixture: Fixture, baseline: WatchBaseline): Promise<void> {
  fixture.holdReads();
  try {
    for (let attempt = 0; attempt < 9; attempt++) {
      await page.waitForTimeout(3_000);
      const trace = await readNativeFriendWatchTrace(page);
      const patch = fixture.calls.slice().reverse().find((call) => call.method === "PATCH" && call.completed);
      if (fixture.calls.filter((call) => call.method === "PATCH").length > baseline.patchRequests &&
          trace.events.filter((event) => event.kind === "patch" && event.source === "friend-watch").length > baseline.watchTaggedPatches) {
        expect(patch?.body).toMatchObject({ latitude: 51.514, longitude: -0.126 });
        expect(Number(patch?.body?.accuracy)).toBeGreaterThanOrEqual(110);
        expect(trace.events.filter((event) => event.kind === "error")).toEqual([]);
        expect(trace.active.length).toBeGreaterThan(0);
        return;
      }
    }
    throw new Error("No completed browser PATCH from a working native friend watcher.");
  } catch (error) {
    try {
      await attachEvidence(page, fixture, "working-watch-failed");
    } catch {
      await test.info().attach("working-watch diagnostics unavailable", {
        body: JSON.stringify({ checkpoint: "working-watch-failed", unavailable: true }),
        contentType: "application/json",
      }).catch(() => {});
    }
    throw error;
  } finally { fixture.releaseReads(); }
}

async function keepMovingForOnePoll(context: BrowserContext, page: Page): Promise<void> {
  const end = Date.now() + FRIEND_LOCATION_POLL_MS + 2_000;
  for (let step = 0; Date.now() < end; step++) {
    await context.setGeolocation({ latitude: 51.521345 + step * 0.00001, longitude: -0.131345, accuracy: 12 });
    await page.waitForTimeout(2_500);
  }
}

test("a working watcher retires on actual tab hide and waits for authority before resuming", async ({ page, context }) => {
  test.setTimeout(120_000);
  const { fixture, panel, watchBaseline } = await prepareOwner(page, context);
  let other: Page | undefined;
  try {
    await proveWorkingWatch(page, fixture, watchBaseline);
    await attachEvidence(page, fixture, "before-hide");
    const active = (await readNativeFriendWatchTrace(page)).active;
    other = await context.newPage();
    await other.goto("about:blank");
    const [originalWindow, otherWindow] = await Promise.all([page, other].map(async (tab) => {
      const session = await context.newCDPSession(tab);
      try { return (await session.send("Browser.getWindowForTarget")).windowId; }
      finally { await session.detach(); }
    }));
    const sameWindow = originalWindow === otherWindow;
    expect(sameWindow).toBe(true);
    await other.bringToFront();
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("hidden");
    await expect(panel.getByRole("status")).toHaveText("Updates paused while this page is hidden.");
    await expect.poll(async () => (await readNativeFriendWatchTrace(page)).active).toEqual([]);
    const hidden = await readNativeFriendWatchTrace(page);
    expect(hidden.events.filter((event) => event.kind === "clear").map((event) => event.id)).toEqual(expect.arrayContaining(active));
    await expect(page.locator(".friendLocationMarker")).toHaveCount(0);
    await expect(panel.locator("li")).toHaveCount(0);
    const calls = fixture.calls.length;
    await keepMovingForOnePoll(context, other);
    expect(fixture.calls).toHaveLength(calls);
    await attachEvidence(page, fixture, "after-hide", sameWindow);
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("hidden");

    fixture.holdReads();
    await page.bringToFront();
    await expect.poll(() => fixture.pendingReads()).toBe(1);
    expect((await readNativeFriendWatchTrace(page)).active).toEqual([]);
    await expect(page.locator(".friendLocationMarker")).toHaveCount(0);
    fixture.releaseReads();
    await expect(panel.getByRole("status")).toHaveText("Sharing with selected mates.");
    await expect.poll(async () => (await readNativeFriendWatchTrace(page)).active.length).toBeGreaterThan(0);
    await expect(page.locator(".friendLocationMarker")).toHaveCount(1);
    await attachEvidence(page, fixture, "after-authority-resume", sameWindow);
  } finally { fixture.releaseReads(); await other?.close(); }
});

test("explicit account sign-out retires a proven working watcher and private rendered state", async ({ page, context }) => {
  test.setTimeout(120_000);
  const { auth, fixture, watchBaseline } = await prepareOwner(page, context);
  try {
    await proveWorkingWatch(page, fixture, watchBaseline);
    await attachEvidence(page, fixture, "before-sign-out");
    const active = (await readNativeFriendWatchTrace(page)).active;
    await auth.signedInAs(null);
    await page.getByRole("button", { name: /Account options/ }).first().click();
    await page.locator(".authAccountMenu").getByRole("button", { name: "Sign out", exact: true }).click();
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBeNull();
    await expect.poll(async () => (await readNativeFriendWatchTrace(page)).active).toEqual([]);
    const signedOut = await readNativeFriendWatchTrace(page);
    expect(signedOut.events.filter((event) => event.kind === "clear").map((event) => event.id)).toEqual(expect.arrayContaining(active));
    await expect(page.locator(".friendLocationMarker")).toHaveCount(0);
    await expect(page.locator(".friendLocationSharingBadge")).toHaveCount(0);
    await page.getByRole("button", { name: "Friend locations", exact: true }).click();
    const panel = page.getByRole("region", { name: "Friend locations" });
    await expect(panel.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    await expect(panel.locator("li")).toHaveCount(0);
    const calls = fixture.calls.length;
    await keepMovingForOnePoll(context, page);
    expect(fixture.calls).toHaveLength(calls);
    await attachEvidence(page, fixture, "after-sign-out");
  } finally { fixture.releaseReads(); }
});
