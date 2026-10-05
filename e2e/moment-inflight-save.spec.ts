import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page, type Request } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles, resumeCookie, seedSignedIn } from "./helpers/authDoubles";

// Real compiled app, real Moment store (IndexedDB), real same-document
// navigation and the real resume route and cookie jar. The Memory and Moment
// upload transport and GoTrue are explicit doubles: this proves upload counts
// and device state, not server persistence or provider revocation.
test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });

const PHOTO = readFileSync(resolve(process.cwd(), "docs/proof/night-mode-mid-crawl/after-390.png"));
const PHOTO_SHA = createHash("sha256").update(PHOTO).digest("hex");

function photos(...names: string[]) {
  return names.map((name) => ({ name, mimeType: "image/png", buffer: PHOTO }));
}

async function storedMomentDraft(page: Page, ownerKey: string) {
  return page.evaluate((owner) => new Promise<{ caption: string; media: string[] } | null>((done, fail) => {
    const open = indexedDB.open("pubmaxx-moment-drafts", 1);
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("drafts")) { db.close(); done(null); return; }
      const read = db.transaction("drafts", "readonly").objectStore("drafts").get(owner);
      read.onsuccess = () => {
        const row = read.result as { caption: string; media: { name: string }[] } | undefined;
        db.close();
        done(row ? { caption: row.caption, media: row.media.map((item) => item.name) } : null);
      };
      read.onerror = () => fail(read.error);
    };
  }), ownerKey);
}

type StoredMedia = { name: string; version: string | null; sha: string; updatedAt: string };

/** Each stored photo's name, edit version and the SHA-256 of the bytes IndexedDB holds for it. */
async function storedMomentMedia(page: Page, ownerKey: string) {
  return page.evaluate((owner) => new Promise<{ caption: string; updatedAt: string; media: Omit<StoredMedia, "updatedAt">[] } | null>((done, fail) => {
    const open = indexedDB.open("pubmaxx-moment-drafts", 1);
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("drafts")) { db.close(); done(null); return; }
      const read = db.transaction("drafts", "readonly").objectStore("drafts").get(owner);
      read.onsuccess = async () => {
        const row = read.result as { caption: string; updatedAt: string; media: { name: string; version?: string; blob: Blob }[] } | undefined;
        db.close();
        if (!row) { done(null); return; }
        const media = await Promise.all(row.media.map(async (item) => {
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await item.blob.arrayBuffer()));
          return { name: item.name, version: item.version ?? null, sha: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
        }));
        done({ caption: row.caption, updatedAt: row.updatedAt, media });
      };
      read.onerror = () => fail(read.error);
    };
  }), ownerKey);
}

/** The photo part of a multipart Moment upload: its filename and the SHA-256 of the bytes sent. */
function uploadedPhoto(request: Request) {
  const body = request.postDataBuffer() ?? Buffer.alloc(0);
  const text = body.toString("latin1");
  const boundary = /boundary=(.+)$/.exec(request.headers()["content-type"] ?? "")?.[1] ?? "";
  const part = text.indexOf('name="photo"');
  const start = text.indexOf("\r\n\r\n", part) + 4;
  const end = text.indexOf(`\r\n--${boundary}`, start);
  return {
    photo: /filename="([^"]+)"/.exec(text)?.[1] ?? "none",
    caption: /name="caption"\r\n\r\n([^\r]*)/.exec(text)?.[1] ?? "",
    sha: part === -1 ? "none" : createHash("sha256").update(body.subarray(start, end)).digest("hex"),
  };
}

for (const edited of [false, true]) {
  test(`a ${edited ? "newer visit with an edited caption" : "newer unchanged visit"} does not upload a photo the earlier visit is still sending`, async ({ page }, testInfo) => {
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    const uploads: { photo: string; caption: string }[] = [];
    let releaseSecond = () => {};
    const secondHeld = new Promise<void>((resolve) => { releaseSecond = resolve; });
    await page.route((url) => url.pathname === "/api/night-memories", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ memory: { id: "memory-1" } }) });
    });
    await page.route("**/api/night-memories/*/moments", async (route) => {
      const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
      uploads.push({
        photo: /filename="([^"]+)"/.exec(body)?.[1] ?? "none",
        caption: /name="caption"\r\n\r\n([^\r]*)/.exec(body)?.[1] ?? "",
      });
      if (uploads.length === 2) await secondHeld;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    try {
      await page.goto("/moment");
      await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true }).first()).toBeVisible();
      await page.locator('input[type="file"]').setInputFiles(photos("one.png", "two.png", "three.png"));
      await expect(page.locator("figure.momentMedia")).toHaveCount(3);
      await expect.poll(async () => (await storedMomentDraft(page, ACCOUNTS.A.id))?.media.length).toBe(3);
      await page.getByRole("button", { name: "Save private Moment", exact: true }).click();
      await expect.poll(() => uploads.length).toBe(2);

      // Leave and come back in the same document while photo two is in flight.
      await page.getByRole("link", { name: "Back", exact: true }).click();
      await expect(page).not.toHaveURL(/\/moment/);
      await page.goBack();
      await expect(page).toHaveURL(/\/moment/);
      await expect(page.locator("figure.momentMedia")).toHaveCount(2);
      if (edited) {
        await page.getByPlaceholder("One line you will still remember next year.").fill("Edited in the newer visit");
      }
      await page.getByRole("button", { name: "Save private Moment", exact: true }).click();
      await page.waitForTimeout(1_000);
      expect(uploads.map((upload) => upload.photo)).toEqual(["one.png", "two.png"]);

      releaseSecond();
      await expect.poll(() => uploads.length).toBe(3);
      await expect(page.getByText("Moment saved privately. You decide if it becomes a Story.", { exact: true })).toBeVisible();
      await testInfo.attach("moment-inflight", { body: await page.screenshot({ path: testInfo.outputPath(`moment-inflight-${edited ? "edited" : "unchanged"}.png`) }), contentType: "image/png" });
      expect(uploads).toEqual([
        { photo: "one.png", caption: "" },
        { photo: "two.png", caption: "" },
        { photo: "three.png", caption: edited ? "Edited in the newer visit" : "" },
      ]);

      await page.goto("/moment");
      await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true }).first()).toBeVisible();
      // Nothing is left to save; the fresh composer may already have stored its empty draft.
      expect((await storedMomentDraft(page, ACCOUNTS.A.id)) ?? { caption: "", media: [] }).toEqual({ caption: "", media: [] });
      await expect(page.locator("figure.momentMedia")).toHaveCount(0);
    } finally {
      releaseSecond();
    }
  });
}

test("a photo cropped in a newer visit survives the earlier visit's upload of its original bytes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  const uploads: { photo: string; caption: string; sha: string }[] = [];
  const holds = new Map<number, () => void>();
  const answered = new Set<number>();
  const held = (index: number) => new Promise<void>((resolve) => { holds.set(index, resolve); });
  await page.route((url) => url.pathname === "/api/night-memories", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ memory: { id: "memory-1" } }) });
  });
  await page.route("**/api/night-memories/*/moments", async (route) => {
    uploads.push(uploadedPhoto(route.request()));
    const index = uploads.length;
    if (index === 2 || index === 3) await held(index);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    answered.add(index);
  });
  try {
    await page.goto("/moment");
    await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true }).first()).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(photos("one.png", "two.png", "three.png"));
    await expect.poll(async () => (await storedMomentDraft(page, ACCOUNTS.A.id))?.media.length).toBe(3);
    await page.getByRole("button", { name: "Save private Moment", exact: true }).click();
    await expect.poll(() => uploads.length).toBe(2);

    await page.getByRole("link", { name: "Back", exact: true }).click();
    await expect(page).not.toHaveURL(/\/moment/);
    await page.goBack();
    await expect(page.locator("figure.momentMedia")).toHaveCount(2);
    await page.getByRole("button", { name: "Edit two.png" }).click();
    await page.getByRole("button", { name: "Use photo" }).click();
    await page.getByRole("button", { name: "Use photo" }).click();
    await expect(page.getByText("Edited photo ready.")).toBeVisible();
    await page.getByPlaceholder("One line you will still remember next year.").fill("Cropped in the newer visit");

    // Before the earlier upload answers: the crop and caption are stored, and
    // the stored bytes are the editor's output, not the original photo.
    await expect.poll(async () => storedMomentDraft(page, ACCOUNTS.A.id)).toEqual({
      caption: "Cropped in the newer visit",
      media: [expect.stringMatching(/^two-edited\./), "three.png"],
    });
    const beforeRelease = (await storedMomentMedia(page, ACCOUNTS.A.id))!;
    const [crop, three] = beforeRelease.media;
    expect(crop?.version).toEqual(expect.any(String));
    expect(crop?.sha).not.toBe(PHOTO_SHA);
    expect(three).toEqual({ name: "three.png", version: null, sha: PHOTO_SHA });
    expect(uploads.map((upload) => upload.sha)).toEqual([PHOTO_SHA, PHOTO_SHA]);

    // The earlier visit's upload of the original bytes succeeds and settles
    // its receipt into the stored draft. A fresh updatedAt is that write only
    // because no edit follows the caption the poll above saw stored; an
    // autosave is debounced off edits, so this signal holds for this script.
    holds.get(2)?.();
    await expect.poll(() => answered.has(2)).toBe(true);
    await expect.poll(async () => (await storedMomentMedia(page, ACCOUNTS.A.id))?.updatedAt).not.toBe(beforeRelease.updatedAt);
    const afterSettlement = (await storedMomentMedia(page, ACCOUNTS.A.id))!;
    expect(afterSettlement.caption).toBe("Cropped in the newer visit");
    expect(afterSettlement.media).toEqual([crop, three]);

    await page.getByRole("button", { name: "Save private Moment", exact: true }).click();
    await expect.poll(() => uploads.length).toBe(3);
    // While the newer save is uploading the crop: still stored, same bytes.
    expect((await storedMomentMedia(page, ACCOUNTS.A.id))?.media).toEqual([crop, three]);
    await testInfo.attach("moment-crop-mid-save", { body: await page.screenshot({ path: testInfo.outputPath("moment-crop-mid-save.png") }), contentType: "image/png" });
    holds.get(3)?.();
    await expect(page.getByText("Moment saved privately. You decide if it becomes a Story.", { exact: true })).toBeVisible();
    expect(uploads).toEqual([
      { photo: "one.png", caption: "", sha: PHOTO_SHA },
      { photo: "two.png", caption: "", sha: PHOTO_SHA },
      { photo: crop!.name, caption: "Cropped in the newer visit", sha: crop!.sha },
      { photo: "three.png", caption: "", sha: PHOTO_SHA },
    ]);

    await page.goto("/moment");
    await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true }).first()).toBeVisible();
    // Nothing is left to save; the fresh composer may already have stored its empty draft.
    expect((await storedMomentDraft(page, ACCOUNTS.A.id)) ?? { caption: "", media: [] }).toEqual({ caption: "", media: [] });
  } finally {
    for (const release of holds.values()) release();
  }
});

test("an explicit sign-out stops the remembered sign-in counting even when its page closes before the DELETE lands", async ({ page, context }, testInfo) => {
  await installAuthDoubles(page, { realResumeCookie: true });
  await seedSignedIn(page, "A");
  await page.goto("/today");
  await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true }).first()).toBeVisible();
  await expect.poll(() => resumeCookie(page)).not.toBeNull();
  const hint = async () => (await (await context.request.get("/api/auth/session")).json() as { hint: unknown }).hint;
  expect(await hint()).not.toBeNull();

  let deleteSeen = false;
  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deleteSeen = true;
    // The DELETE never lands: the page closes first. This proves the local
    // generation fence only, not server revocation or cross-document ordering.
  });
  await expect(async () => {
    const menu = page.locator(".authAccountMenu");
    if (!(await menu.isVisible())) await page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true }).first().click();
    await expect(menu).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.locator(".authAccountMenu").getByRole("button", { name: /^Sign out/ }).first().click();
  await expect.poll(() => deleteSeen).toBe(true);
  await testInfo.attach("signed-out-before-close", { body: await page.screenshot({ path: testInfo.outputPath("signed-out-before-close.png") }), contentType: "image/png" });
  await page.close();

  expect((await context.cookies()).some((cookie) => cookie.name === "pubmax_session_resume")).toBe(true);
  expect(await hint()).toBeNull();
});
