import { expect, test } from "@playwright/test";
import { ACCOUNTS, accessJwt, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// Real mounted UI, with auth and save transport doubles. This does not prove
// GoTrue revocation, durable persistence, or database permissions.
test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });

test("an old account's pending Moment save cannot continue after a UI account switch", async ({ page }, testInfo) => {
  const stub = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await stub.signedInAs("B");
  await page.goto("/today");
  await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.B.name}`, exact: true }).first()).toBeVisible();
  await stub.signedInAs("A");

  let releaseMemory!: () => void;
  const memoryHeld = new Promise<void>((resolve) => { releaseMemory = resolve; });
  let memoryStarted = false;
  let memoryFinished = false;
  const moments: { caption: unknown; owner: string }[] = [];
  await page.route((url) => url.pathname === "/api/night-memories", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    memoryStarted = true;
    await memoryHeld;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ memory: { id: "owner-a-held-memory" } }) });
    memoryFinished = true;
  });
  await page.route("**/api/night-memories/*/moments", async (route) => {
    const auth = route.request().headers().authorization;
    const owner = auth === `Bearer ${accessJwt(ACCOUNTS.B)}` || auth === "Bearer pubmaxx-e2e-access-token-B" ? "B" : "A";
    const body = route.request().postDataJSON() as { caption?: unknown };
    moments.push({ caption: body.caption, owner });
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  try {
    await page.goto("/moment");
    const caption = page.getByPlaceholder("One line you will still remember next year.");
    await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true }).first()).toBeVisible();
    await caption.fill("Owner A's private fixture caption.");
    await page.getByRole("button", { name: "Save private Moment", exact: true }).click();
    await expect.poll(() => memoryStarted).toBe(true);
    await expect(async () => {
      const menu = page.locator(".authAccountMenu");
      if (!(await menu.isVisible())) await page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true }).first().click();
      await expect(menu).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: "Switch account", exact: true }).click();
    await expect(page.locator(".authSwitcherRow")).toHaveCount(1);
    await page.locator(".authSwitcherRow").click();
    await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.B.name}`, exact: true }).first()).toBeVisible();
    await expect(caption).toHaveValue("");
    releaseMemory();
    await expect.poll(() => memoryFinished).toBe(true);
    // Allow the released transport's JSON and promise continuations, plus the
    // receipt navigation timer, to run. This window detects forbidden writes.
    await page.waitForTimeout(2_000);
    await testInfo.attach("moment-account-save-requests", { body: JSON.stringify({ moments }), contentType: "application/json" });
    await testInfo.attach("moment-account-switch", { body: await page.screenshot(), contentType: "image/png" });
    expect(moments).toEqual([]);
    await expect(page).toHaveURL(/\/moment$/);
    await expect(caption).toHaveValue("");
    await expect(page.getByText("Moment saved privately. You decide if it becomes a Story.", { exact: true })).toHaveCount(0);
  } finally {
    releaseMemory();
  }
});

test("a previous owner's caption stays hidden while the next account's device draft loads", async ({ page }, testInfo) => {
  const stub = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await stub.signedInAs("B");
  await page.goto("/today");
  await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.B.name}`, exact: true }).first()).toBeVisible();
  await stub.signedInAs("A");
  await page.goto("/moment");
  const caption = page.getByPlaceholder("One line you will still remember next year.");
  await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true }).first()).toBeVisible();
  await caption.fill("Owner A's private fixture caption.");
  await expect.poll(() => page.evaluate((ownerKey) => new Promise<{ ownerKey: string; caption: string } | null>((resolve, reject) => {
    const request = indexedDB.open("pubmaxx-moment-drafts", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("drafts", "readonly");
      transaction.oncomplete = () => db.close();
      const read = transaction.objectStore("drafts").get(ownerKey);
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const draft = read.result as { ownerKey: string; caption: string } | undefined;
        resolve(draft ? { ownerKey: draft.ownerKey, caption: draft.caption } : null);
      };
    };
  }), ACCOUNTS.A.id)).toEqual({ ownerKey: ACCOUNTS.A.id, caption: "Owner A's private fixture caption." });
  // A real IndexedDB transaction models another tab using the same device
  // store. It delays the next restore without changing React or auth state.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("pubmaxx-moment-drafts", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("drafts", "readwrite");
      let released = false;
      (window as unknown as { releaseMomentStorage: () => void }).releaseMomentStorage = () => { released = true; };
      transaction.oncomplete = () => db.close();
      const hold = () => {
        const read = transaction.objectStore("drafts").get("__fixture_hold__");
        read.onsuccess = () => { if (!released) hold(); };
      };
      hold();
      resolve();
    };
  }));
  try {
    await expect(async () => {
      const menu = page.locator(".authAccountMenu");
      if (!(await menu.isVisible())) await page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true }).first().click();
      await expect(menu).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: "Switch account", exact: true }).click();
    await page.locator(".authSwitcherRow").click();
    await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.B.name}`, exact: true }).first()).toBeVisible();
    await testInfo.attach("moment-draft-held-on-account-switch", { body: await page.screenshot(), contentType: "image/png" });
    const samples = await page.evaluate(() => new Promise<string[]>((resolve) => {
      const values: string[] = [];
      const sample = () => {
        const field = document.querySelector<HTMLTextAreaElement>('.momentFields textarea');
        values.push(field && field.getClientRects().length > 0 ? field.value : "");
        if (values.length === 8) resolve(values);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    await testInfo.attach("moment-caption-before-paint", { body: JSON.stringify(samples), contentType: "application/json" });
    expect(samples.every((value) => value === "")).toBe(true);
  } finally {
    await page.evaluate(() => (window as unknown as { releaseMomentStorage: () => void }).releaseMomentStorage());
  }
  await expect(caption).toHaveValue("");
  await caption.fill("Owner B's independent fixture caption.");
  await expect(page.getByRole("button", { name: "Save private Moment", exact: true })).toBeEnabled();
});
