import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { FRIEND_LOCATION_POLL_MS } from "../../lib/friendLocation";
import { UI_UX_CHROMIUM_ARGS } from "../../scripts/lib/uiUxBattleTestBrowser.mjs";
import { ACCOUNTS, installAuthDoubles, readDeviceIdentity, seedSignedIn } from "../../e2e/helpers/authDoubles";
import { installFriendLocationBrowserDoubles, installNativeFriendWatchTrace, readNativeFriendWatchTrace } from "../../e2e/helpers/friendLocationBrowser";

test.use({
  headless: false, viewport: { width: 1440, height: 900 }, serviceWorkers: "block",
  launchOptions: { args: [...UI_UX_CHROMIUM_ARGS] }, trace: "off", video: "off",
});

type Fixture = Awaited<ReturnType<typeof installFriendLocationBrowserDoubles>>;

async function attachEvidence(page: Page, fixture: Fixture, checkpoint: string): Promise<void> {
  const trace = await readNativeFriendWatchTrace(page);
  const panel = page.getByRole("region", { name: "Friend locations" });
  const statusNode = panel.getByRole("status");
  const status = await statusNode.count() ? await statusNode.textContent() : null;
  const knownStatus = ["Sharing with selected mates.", "Updates paused while this page is hidden.", "Choose who can see you."];
  const receipt = {
    checkpoint, syntheticPositionsOnly: true,
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    origin: new URL(page.url()).origin,
    visibility: await page.evaluate(() => document.visibilityState),
    permission: await page.evaluate(() => navigator.permissions.query({ name: "geolocation" }).then((permission) => permission.state)),
    nativeWatch: {
      activeIds: trace.active,
      events: trace.events.map((event) => ({ kind: event.kind, id: event.id, source: event.source, state: event.state })),
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
  await seedSignedIn(page, "A");
  await page.goto("/map");
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => navigator.permissions.query({ name: "geolocation" }).then((permission) => permission.state))).toBe("granted");
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("visible");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await expect(async () => {
    await page.getByRole("button", { name: "Friend locations", exact: true }).click();
    await expect(page.getByRole("region", { name: "Friend locations" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  const panel = page.getByRole("region", { name: "Friend locations" });
  await panel.getByRole("checkbox", { name: ACCOUNTS.B.handle, exact: true }).check();
  await panel.getByRole("button", { name: "Share my location", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Sharing with selected mates.");
  await expect(page.locator(".friendLocationMarker")).toHaveCount(1);
  const start = fixture.calls.find((call) => call.method === "POST");
  expect(start?.body).toMatchObject({ recipients: [ACCOUNTS.B.id], latitude: 51.512, longitude: -0.123 });
  expect(Number(start?.body?.accuracy)).toBeGreaterThanOrEqual(110);
  return { auth, fixture, panel };
}

async function proveWorkingWatch(page: Page, context: BrowserContext, fixture: Fixture): Promise<void> {
  const baseline = fixture.calls.filter((call) => call.method === "PATCH").length;
  const traced = (await readNativeFriendWatchTrace(page)).events.filter((event) => event.kind === "patch" && event.source === "friend-watch").length;
  fixture.holdReads();
  try {
    for (let attempt = 0; attempt < 9; attempt++) {
      await context.setGeolocation({ latitude: 51.514234 + attempt * 0.00001, longitude: -0.126456, accuracy: 12 });
      await page.waitForTimeout(3_000);
      const trace = await readNativeFriendWatchTrace(page);
      const patch = fixture.calls.slice().reverse().find((call) => call.method === "PATCH" && call.completed);
      if (fixture.calls.filter((call) => call.method === "PATCH").length > baseline &&
          trace.events.filter((event) => event.kind === "patch" && event.source === "friend-watch").length > traced) {
        expect(patch?.body).toMatchObject({ latitude: 51.514, longitude: -0.126 });
        expect(Number(patch?.body?.accuracy)).toBeGreaterThanOrEqual(110);
        expect(trace.events.filter((event) => event.kind === "error")).toEqual([]);
        expect(trace.active.length).toBeGreaterThan(0);
        return;
      }
    }
    throw new Error("No completed browser PATCH from a working native friend watcher.");
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
  const { fixture, panel } = await prepareOwner(page, context);
  let other: Page | undefined;
  try {
    await proveWorkingWatch(page, context, fixture);
    await attachEvidence(page, fixture, "before-hide");
    const active = (await readNativeFriendWatchTrace(page)).active;
    other = await context.newPage();
    await other.goto("about:blank");
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
    await attachEvidence(page, fixture, "after-hide");
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
    await attachEvidence(page, fixture, "after-authority-resume");
  } finally { fixture.releaseReads(); await other?.close(); }
});

test("explicit account sign-out retires a proven working watcher and private rendered state", async ({ page, context }) => {
  test.setTimeout(120_000);
  const { auth, fixture } = await prepareOwner(page, context);
  try {
    await proveWorkingWatch(page, context, fixture);
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
