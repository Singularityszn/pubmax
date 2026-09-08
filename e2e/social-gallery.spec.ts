import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const postId = "11111111-1111-4111-8111-111111111111";
const ids = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
const photos = ids.map((mediaId, index) => ({ mediaId, altText: `Canal view ${index + 1}`, kind: "photo", contentType: "image/jpeg" }));
const post = { id: postId, kind: "standard", visibility: "public", body: "A walk along the canal", area: "camden",
  venueId: null, venueName: null, venueProjected: false, hashtags: [], commentPolicy: "open",
  photo: photos[0], photos, moderationState: "approved", featureRequest: null, revision: 1, mutationVersion: 1,
  editedAt: null, createdAt: "2026-09-07T18:00:00Z", updatedAt: "2026-09-07T18:00:00Z", author: { handle: "alice" }, ownedByViewer: false };

async function session(page: Page) {
  await page.addInitScript(() => {
    const id = "00000000-0000-4000-8000-000000000010";
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("sb-pubmaxx-e2e-auth-token", JSON.stringify({ access_token: `pubmaxx-e2e-access-token-${id}`,
      refresh_token: "pubmaxx-e2e-refresh-token", expires_at: Math.floor(Date.now() / 1000) + 86400, expires_in: 86400, token_type: "bearer",
      user: { id, aud: "authenticated", role: "authenticated", email: "gallery@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-07-29T00:00:00Z" } }));
  });
  await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/auth/v1/**", route => route.fulfill({ status: 401, json: { message: "Mock session only" } }));
  await page.route("**/api/identity/handle/current", route => route.fulfill({ json: { handle: "alice", hasPassword: true } }));
  await page.route("**/api/identity/onboarding", route => route.fulfill({ json: { complete: true, handle: "alice", dateOfBirth: "1995-03-21" } }));
  await page.route("**/api/social/access", route => route.fulfill({ json: { state: "verified", viewerHandle: "alice", draftScope: "a".repeat(43) } }));
  await page.route("**/api/social/interactions?**", route => route.fulfill({ json: { items: [], comments: [], nextCursor: null, summary: { cheered: false, cheerCount: 0, repostCount: 0 } } }));
  await page.route("**/api/social/outbox", route => route.fulfill({ json: { posts: [] } }));
  await page.route("**/api/social/tags**", route => route.fulfill({ json: { proposals: [], nextCursor: null } }));
  await page.route("**/api/social/crews**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/social/media/**", route => {
    const mediaId = new URL(route.request().url()).pathname.split("/").at(-1)!;
    return route.fulfill({ json: { url: `/gallery-proof-${Math.max(0, ids.indexOf(mediaId))}.webp`, kind: "photo", contentType: "image/webp" } });
  });
  await page.route("**/gallery-proof-*.webp", route => {
    const paths = ["camden-lock", "greenwich-cutty-sark", "borough-market"];
    const index = Number(new URL(route.request().url()).pathname.match(/proof-(\d)/)![1]);
    return route.fulfill({ path: `public/landing/london/${paths[index]}-1280.webp`, contentType: "image/webp" });
  });
}

test("phone gallery retries only the failed upload and commits the chosen order", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await session(page);
  await page.route("**/api/social/posts?**", route => route.fulfill({ json: { posts: [], nextCursor: null } }));
  const uploadKeys: string[] = [];
  await page.route("**/api/social/uploads/photos", route => {
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    uploadKeys.push(route.request().headers()["idempotency-key"]);
    return uploadKeys.length === 2
      ? route.fulfill({ status: 503, json: { error: "Photo upload failed. Try again." } })
      : route.fulfill({ json: { upload: { mediaId: uploadKeys.length === 1 ? ids[0] : ids[1] } } });
  });
  const commits: Array<{ key: string; body: { gallery: Array<{ mediaId: string; altText: string }>; visibility: string } }> = [];
  await page.route("**/api/social/posts", route => {
    commits.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    return commits.length === 1 ? route.fulfill({ status: 503, json: { error: "Connection lost. Try again." } })
      : route.fulfill({ status: 201, json: { post: { ...post, moderationState: "pending", ownedByViewer: true } } });
  });
  await page.goto("/social");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Add photos", { exact: true }).setInputFiles(["public/landing/london/camden-lock-1280.webp", "public/landing/london/greenwich-cutty-sark-1280.webp"]);
  await expect(dialog.getByRole("button", { name: "Retry photos", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry photos", exact: true }).click();
  await expect(dialog.getByText("Photo ready", { exact: true })).toHaveCount(2);
  expect(uploadKeys).toHaveLength(3);
  expect(uploadKeys[2]).toBe(uploadKeys[1]);
  await dialog.getByLabel("Photo 1 description").fill("Canal walk");
  await dialog.getByLabel("Photo 2 description").fill("Garden stop");
  await dialog.getByRole("button", { name: "Move photo 2 earlier" }).click();
  await expect(dialog.getByLabel("Photo 1 description")).toHaveValue("Garden stop");
  await expect(dialog.getByRole("radio", { name: "Friends", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog.getByText("Connection lost. Try again.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("gallery-phone-retry.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(commits).toHaveLength(2);
  expect(commits[1]).toEqual(commits[0]);
  expect(commits[0].body).toMatchObject({ visibility: "friends", gallery: [{ mediaId: ids[1], altText: "Garden stop" }, { mediaId: ids[0], altText: "Canal walk" }] });
  expect(uploadKeys).toHaveLength(3);
});

test("gallery supports keyboard, phone swipe, resizing, and both themes", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await session(page);
  await page.route("**/api/social/posts?**", route => route.fulfill({ json: { posts: [post], nextCursor: null } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/social");
  const gallery = page.getByRole("group", { name: "Post photos", exact: true });
  const track = gallery.getByRole("group", { name: "Photos", exact: true });
  await expect(gallery.getByRole("img", { name: "Canal view 1" })).toBeVisible();
  await track.focus();
  await track.press("ArrowRight");
  await expect(gallery.locator(".socialPostGallery__position")).toHaveText("Photo 2 / 3");
  await track.press("End");
  await expect(gallery.locator(".socialPostGallery__position")).toHaveText("Photo 3 / 3");
  await expect(gallery.getByRole("button", { name: "Next photo" })).toBeDisabled();
  await track.evaluate(element => element.scrollTo({ left: 0, behavior: "instant" }));
  await expect(gallery.locator(".socialPostGallery__position")).toHaveText("Photo 1 / 3");
  await track.scrollIntoViewIfNeeded();
  const bounds = (await track.boundingBox())!;
  const input = await page.context().newCDPSession(page);
  await input.send("Input.synthesizeScrollGesture", { x: bounds.x + bounds.width * 0.8, y: bounds.y + bounds.height * 0.5,
    xDistance: -bounds.width * 0.65, yDistance: 0, gestureSourceType: "touch", speed: 800 });
  await expect(gallery.locator(".socialPostGallery__position")).toHaveText("Photo 2 / 3");
  await input.detach();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const a11y = await new AxeBuilder({ page }).include(".socialPage").withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(a11y.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`gallery-${width}-${theme}.png`), fullPage: true });
    }
  }
});

test("feed videos open a full-screen viewer with one active player and restored focus", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await session(page);
  const videos = ids.slice(0, 2).map((mediaId, index) => ({ ...post, id: mediaId, photos: undefined,
    createdAt: new Date(Date.parse(post.createdAt) - index * 1000).toISOString(),
    body: `Canal performance ${index + 1}`, photo: { mediaId, altText: `Band clip ${index + 1}`, kind: "video", contentType: "video/mp4" } }));
  await page.route("**/api/social/posts?**", route => route.fulfill({ json: { posts: videos, nextCursor: null } }));
  await page.route("**/api/social/media/**", route => route.fulfill({ json: { url: "/gallery-proof.mp4", kind: "video", contentType: "video/mp4" } }));
  await page.route("**/gallery-proof.mp4", route => route.fulfill({ path: "__tests__/fixtures/social-video-faststart.mp4", contentType: "video/mp4" }));
  await page.goto("/social");
  const trigger = page.getByRole("button", { name: "Watch videos", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Feed videos" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close video viewer" })).toBeFocused();
  await expect.poll(() => dialog.locator("video").evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
  await expect(dialog.locator("video")).toHaveCount(1);
  await dialog.locator("video").evaluate(async video => { video.muted = true; video.loop = true; await video.play(); });
  await expect.poll(() => dialog.locator("video").evaluate(video => video.paused)).toBe(false);
  await dialog.getByRole("button", { name: "Next video", exact: true }).click();
  await expect(dialog.locator(".socialVideoViewer__controls [role=status]")).toHaveText("Video 2 / 2");
  await expect(dialog.locator("video")).toHaveCount(1);
  await expect(dialog.locator("video")).toHaveAttribute("aria-label", "Band clip 2");
  await expect.poll(() => dialog.locator("video").evaluate(video => video.paused)).toBe(true);
  const track = dialog.getByRole("group", { name: "Videos", exact: true });
  await track.focus();
  await track.press("Home");
  await expect(dialog.locator(".socialVideoViewer__controls [role=status]")).toHaveText("Video 1 / 2");
  const bounds = (await track.boundingBox())!;
  const input = await page.context().newCDPSession(page);
  await input.send("Input.synthesizeScrollGesture", { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.75,
    xDistance: 0, yDistance: -bounds.height * 0.65, gestureSourceType: "touch", speed: 800 });
  await expect(dialog.locator(".socialVideoViewer__controls [role=status]")).toHaveText("Video 2 / 2");
  await input.detach();
  expect((await new AxeBuilder({ page }).include(".socialVideoViewer").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("feed-video-phone.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.locator("video").evaluateAll(elements => elements.every(video => video.paused))).toBe(true);
});

test("signed-out phone visitors reach the Social access state before the control rail (#1541)", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { localStorage.setItem("pubmax-tour-v1-done", "1"); sessionStorage.setItem("pubmax_onboarding_dismissed", "1"); });
  await page.route("**/api/social/access", route => route.fulfill({ json: { state: "sign_in_required" } }));
  await page.goto("/social");
  await expect(page.locator(".socialMain").getByText(/Sign in/).first()).toBeVisible();
  const positions = await page.evaluate(() => ({
    main: document.querySelector(".socialMain")!.getBoundingClientRect().top,
    rail: document.querySelector(".socialControlRail")!.getBoundingClientRect().top,
  }));
  expect(positions.main).toBeLessThan(positions.rail);
  expect(positions.main).toBeLessThan(844);
  await page.screenshot({ path: testInfo.outputPath("social-signed-out-phone-1541.png"), fullPage: true });
});


test("clearing a failed photo draft allows a text-only post", async ({ page }) => {
  await session(page);
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    const remove = IDBObjectStore.prototype.delete;
    let refuseDeletion = true;
    IDBObjectStore.prototype.delete = function (...args) {
      if (this.transaction.db.name === "pubmaxx-social-gallery-drafts-v1" && refuseDeletion) {
        refuseDeletion = false;
        throw new DOMException("Photo storage is unavailable", "UnknownError");
      }
      return remove.apply(this, args);
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === "pubmaxx-social-gallery-drafts-v1") {
        throw new DOMException("Photo storage is full", "QuotaExceededError");
      }
      return put.apply(this, args);
    };
  });
  await page.route("**/api/social/posts?**", route => route.fulfill({ json: { posts: [], nextCursor: null } }));
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/social/posts", route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { post: { ...post, body: "A walk by the river", photo: null, photos: undefined } } });
  });
  await page.goto("/social");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Add photos", { exact: true }).setInputFiles("public/landing/london/camden-lock-1280.webp");
  await expect(dialog.getByText("Your photos could not be saved on this device. Retry before posting.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Clear draft", exact: true }).click();
  await expect(dialog.getByText("Your photo draft could not be cleared. Try again.", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Photo 1 description")).toBeVisible();
  await dialog.getByRole("button", { name: "Clear draft", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Write post", exact: true }).fill("A walk by the river");
  await expect(dialog.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(submitted).toMatchObject({ body: "A walk by the river" });
  expect(submitted).not.toHaveProperty("gallery");
});


test("a saved gallery stays saved after draft deletion fails and the page reloads", async ({ page }) => {
  await session(page);
  await page.addInitScript(() => {
    const remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (...args) {
      if (this.transaction.db.name === "pubmaxx-social-gallery-drafts-v1"
        && sessionStorage.getItem("allow-saved-draft-cleanup") !== "1") {
        throw new DOMException("Photo storage is unavailable", "UnknownError");
      }
      return remove.apply(this, args);
    };
  });
  await page.route("**/api/social/posts?**", route => route.fulfill({ json: { posts: [], nextCursor: null } }));
  await page.route("**/api/social/uploads/photos", route => route.fulfill({ json: { upload: { mediaId: ids[0] } } }));
  const commits: Array<{ key: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/social/posts", route => {
    commits.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    return route.fulfill({ status: 202, json: { post: { ...post, moderationState: "needs_review", ownedByViewer: true } } });
  });
  await page.goto("/social");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Add photos", { exact: true }).setInputFiles("public/landing/london/camden-lock-1280.webp");
  await expect(dialog.getByText("Photo ready", { exact: true })).toBeVisible();
  await dialog.getByLabel("Photo 1 description").fill("Our canal walk");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect.poll(() => commits.length).toBe(1);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key =>
    key.startsWith("pubmaxx:social-composer:v1:") && JSON.parse(localStorage.getItem(key)!).submitted === true,
  ))).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog.getByText("Post saved. Clear the saved draft before starting another.", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Photo 1 description")).toHaveCount(0);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Clear saved draft", exact: true }).click();
  await expect(dialog.getByText("Post saved. The saved draft could not be cleared. Try again.", { exact: true })).toBeVisible();
  expect(commits).toHaveLength(1);
  await page.evaluate(() => sessionStorage.setItem("allow-saved-draft-cleanup", "1"));
  await dialog.getByRole("button", { name: "Clear saved draft", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Write post", exact: true }).fill("A different night");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(commits).toHaveLength(2);
  expect(commits[1].key).not.toBe(commits[0].key);
  expect(commits[1].body).not.toHaveProperty("gallery");
});
