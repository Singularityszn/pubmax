import { expect, test, type Page } from "@playwright/test";
import { LONDON_BOROUGHS } from "../lib/boroughs";
import { ACCOUNTS, accessJwt, installAuthDoubles, readDeviceAccounts, readDeviceIdentity, seedSignedIn, switchRememberedAccount } from "./helpers/authDoubles";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";

test.use({ serviceWorkers: "block" });

// Real pages and interactions, with auth and profile API fixtures where stated.
test("failed route presentation chunks leave the map link usable", async ({ page }) => {
  const rejected = new Set<string>();
  await page.route("**/_next/static/chunks/*.js*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const matches = ["pintLine__glassBeer", "crawlReceipt__barcode"].filter((marker) => body.includes(marker));
    if (matches.length) {
      matches.forEach((marker) => rejected.add(marker));
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page.goto("/routes/victorian-soho?wild=0");
  await expect(page.getByText("The route diagram could not load. The stops and map link are still available.")).toBeVisible();
  await expect(page.getByText("The selected pints subtotal could not load. The stops still show each listed price.")).toBeVisible();
  expect([...rejected].sort()).toEqual(["crawlReceipt__barcode", "pintLine__glassBeer"]);
  await expect(page.getByRole("list", { name: "Victorian Soho stops" }).locator(".rowListItem")).toHaveCount(5);
  await page.unrouteAll({ behavior: "wait" });
  await page.getByRole("link", { name: "Plan the Victorian Soho crawl on the map" }).click();
  await expect(page).toHaveURL(/\/map\?/);
  await expectMapLoadingFrameReleased(page);
});

test("cancelled touch drag permits keyboard activation and a completed drag does not navigate", async ({ page, context }) => {
  await page.setViewportSize({ width: 641, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tonight?wild=0");
  const frame = page.locator(".pintBeltFrame");
  const mat = frame.locator("a.pintBeltMat").first();
  await expect(mat).toBeVisible();
  await mat.scrollIntoViewIfNeeded();
  const box = (await mat.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await frame.evaluate((node) => node.addEventListener("pointercancel", () => { node.setAttribute("data-test-cancelled", "yes"); }));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 25, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(frame).toHaveAttribute("data-test-cancelled", "yes");
  await mat.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(mat).toBeFocused();
  const href = await mat.getAttribute("href");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${href!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await page.goto("/tonight?wild=0");
  await expect(mat).toBeVisible();
  await mat.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.addEventListener("click", (event) => {
    setTimeout(() => document.body.setAttribute("data-test-drag-click", String(event.defaultPrevented)), 0);
  }, { capture: true, once: true }));
  const start = (await mat.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 25, start.y + start.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("body")).toHaveAttribute("data-test-drag-click", "true");
  await expect(page).toHaveURL(/\/tonight/);
});

async function roundsFixture(page: Page) {
  await page.route("**/api/rounds/BCDFGH", async (route) => {
    const bearer = route.request().headers().authorization ?? "";
    const b = bearer.endsWith("-B") || bearer === `Bearer ${accessJwt(ACCOUNTS.B)}`;
    await route.fulfill({ json: { round: { id: "round-rota-browser", code: "BCDFGH", title: "Turn preview", createdByHandle: ACCOUNTS.A.handle, createdAt: "2026-11-01T12:00:00Z", closedAt: null }, members: Object.values(ACCOUNTS).map((account) => ({ handle: account.handle, joinedAt: "2026-11-01T12:00:00Z" })), stops: [], spends: [], viewerMemberHandle: b ? ACCOUNTS.B.handle : ACCOUNTS.A.handle } });
  });
}

test("fixture-backed cross-tab account switch clears mounted private turn names", async ({ page, context }) => {
  const auth = await installAuthDoubles(page);
  await roundsFixture(page);
  await seedSignedIn(page, "A");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await auth.signedInAs("B");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceAccounts(page)).length).toBe(2);
  await auth.signedInAs("A");
  await page.goto("/rounds/BCDFGH?wild=1&wildpreview=round-rota");
  const tracker = page.getByRole("region", { name: "Your turn order", exact: true });
  await tracker.getByLabel("Add a name").fill("Private Sam");
  await tracker.getByLabel("Add a name").press("Enter");
  await page.reload();
  await expect(tracker.getByRole("list").getByText("Private Sam", { exact: true })).toBeVisible();
  const control = await context.newPage();
  await installAuthDoubles(control);
  await control.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(control)).handle).toBe(ACCOUNTS.A.handle);
  await switchRememberedAccount(control, "A", "B");
  await expect(tracker.getByText("Private Sam", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("pubmax:wild-round-rota:v1"))).toBeNull();
});

test("fixture-backed normal bingo keeps count, sharing and visitor privacy with preview off", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-write", "clipboard-read"]);
  await installAuthDoubles(page);
  await page.route((url) => url.pathname === `/api/profiles/${ACCOUNTS.A.handle}`, (route) => route.fulfill({ json: { profile: { id: ACCOUNTS.A.id, handle: ACCOUNTS.A.handle, displayName: ACCOUNTS.A.name, createdAt: "2026-08-01T12:00:00Z", updatedAt: "2026-08-01T12:00:00Z" }, socialLinks: [], counts: { followers: 0, following: 0 }, viewerFollowing: false, followsViewer: false } }));
  await page.route("**/api/pint-drops?author=*", (route) => route.fulfill({ json: { drops: [], passportAreas: LONDON_BOROUGHS.slice(0, 11) } }));
  let beenReads = 0;
  let indexReads = 0;
  await page.route(`**/api/profiles/${ACCOUNTS.A.handle}/been`, async (route) => {
    const bearer = await route.request().headerValue("authorization");
    const owner = bearer === "Bearer pubmaxx-e2e-access-token-A" || bearer === `Bearer ${accessJwt(ACCOUNTS.A)}`;
    if (owner) beenReads += 1;
    await route.fulfill({ json: { access: owner ? "full" : "shared", status: "ready", count: 0, venues: [], wantToTryCount: null, cover: null } });
  });
  await page.route("**/data/venues_slim.json*", (route) => { indexReads += 1; return route.continue(); });
  await page.route(`**/api/profiles/${ACCOUNTS.A.handle}/borough-bingo`, (route) => route.fulfill({ json: { path: `/u/${ACCOUNTS.A.handle}/boroughs/fixture` } }));
  await seedSignedIn(page, "A");
  await page.goto(`/u/${ACCOUNTS.A.handle}?wild=1&wildpreview=off`);
  const board = page.getByTestId("borough-bingo");
  await expect(board).toHaveCount(1);
  await expect(board.getByTestId("borough-bingo-count")).toContainText("11 of 33 boroughs");
  await expect(board.locator("li")).toHaveCount(33);
  await board.getByRole("button", { name: "Share your card" }).click();
  await expect(board.getByRole("status")).toHaveText("Link copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/u/${ACCOUNTS.A.handle}/boroughs/fixture`);
  await expect.poll(() => beenReads).toBeGreaterThan(0);
  expect(indexReads).toBe(0);
  await seedSignedIn(page, "B");
  await page.goto(`/u/${ACCOUNTS.A.handle}?wild=1&wildpreview=off`);
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect(page.getByTestId("borough-bingo")).toHaveCount(0);
  await expect(page.getByTestId("borough-bingo-count")).toHaveCount(0);
});
