import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const basePost = {
  id: POST_ID, kind: "standard", visibility: "friends", body: "Original night",
  area: "camden", venueId: "venue-a", venueProjected: true, hashtags: ["camden"],
  commentPolicy: "open", photo: { mediaId: "22222222-2222-4222-8222-222222222222", altText: "Friends outside" },
  moderationState: "approved", featureRequest: null, revision: 1, editedAt: null,
  createdAt: "2026-08-05T18:00:00.000Z", updatedAt: "2026-08-05T18:00:00.000Z",
  author: { handle: "alice" },
};

async function mockVerified(page: Page) {
  await page.route("**/api/social/access", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: "verified", viewerHandle: "alice", draftScope: "a".repeat(43) }) }));
  await page.route("**/api/social/interactions?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) }));
  await page.route("**/api/social/outbox", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [{ id: "held-1", moderationState: "needs_review", revision: 1, createdAt: "2026-08-05T19:00:00.000Z" }] }) }));
  await page.route("**/api/social/venues?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ venues: [{ id: "venue-a", name: "The Proof Arms", borough: "Camden" }] }) }));
  await page.route("**/api/social/media/**", (route) => route.fulfill({ status: 404, body: "" }));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("pubmax-tour-v1-done", "1"); sessionStorage.setItem("pubmax_onboarding_dismissed", "1"); });
});

test("verified composer preserves failed photo draft, records consent choices, and recovers stale edit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockVerified(page);
  let currentPost = { ...basePost };
  let createAttempts = 0;
  const createKeys: string[] = [];
  let editAttempts = 0;
  const editPayloads: Array<Record<string, unknown>> = [];
  const tagActions: string[] = [];
  await page.route("**/api/social/tags", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals: [{ id: "tag-1", postId: POST_ID, authorHandle: "bob", state: tagActions.includes("approve") ? "approved" : "proposed", createdAt: "2026-08-05T19:00:00.000Z" }] }) });
    tagActions.push(String((await route.request().postDataJSON()).action));
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/social/posts?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [currentPost], nextCursor: null }) }));
  await page.route(`**/api/social/posts/${POST_ID}`, async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ post: { ...currentPost, revision: 2 } }) });
    editAttempts += 1;
    editPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    if (editAttempts === 1) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "EDIT_CONFLICT", error: "Conflict" }) });
    currentPost = editAttempts === 2
      ? { ...currentPost, body: "Edited draft survives", revision: 3, editedAt: "2026-08-05T20:00:00.000Z", photo: { ...basePost.photo!, altText: "Corrected friends outside" } }
      : { ...currentPost, revision: 4, editedAt: "2026-08-05T20:01:00.000Z", photo: null };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ post: currentPost, audit: { fromRevision: 2, toRevision: 3 } }) });
  });
  await page.route("**/api/social/posts", async (route) => {
    createAttempts += 1;
    createKeys.push(route.request().headers()["idempotency-key"] ?? "");
    if (createAttempts === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Moderation unavailable" }) });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ post: { ...currentPost, id: "created-1", moderationState: "pending" } }) });
  });

  await page.goto("/social");
  await expect(page.getByText("Held for review")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await page.getByRole("button", { name: "Withdraw" }).click();
  expect(tagActions).toEqual(["approve", "withdraw"]);

  await page.getByRole("button", { name: "New post" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Post", exact: true })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Post", exact: true }).fill("Photo draft survives reload");
  await dialog.getByLabel("Venue - Friends only").fill("Proof");
  await expect(page.getByRole("button", { name: /The Proof Arms/ })).toBeVisible();
  await page.getByRole("button", { name: /The Proof Arms/ }).click();
  await dialog.getByLabel("Post type").selectOption("feature_request");
  await dialog.getByLabel("Photo", { exact: true }).setInputFiles({ name: "proof.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
  await dialog.getByLabel("Photo description").fill("Friends outside The Proof Arms");
  await dialog.getByLabel("Photo tags", { exact: true }).fill("bob");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Moderation unavailable");
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole("button", { name: "New post" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Post", exact: true })).toHaveValue("Photo draft survives reload");
  await expect(dialog.getByLabel("Photo description")).toBeVisible();
  await expect(dialog.getByLabel("Photo description")).toHaveValue("Friends outside The Proof Arms");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(createKeys).toHaveLength(2);
  expect(createKeys[0]).toBe(createKeys[1]);

  await page.getByRole("button", { name: "New post" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Post", exact: true }).fill("Text-only post");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(createAttempts).toBe(3);
  expect(createKeys[2]).not.toBe(createKeys[1]);

  await page.getByRole("button", { name: "Edit post" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Selected Venue")).toContainText("Venue selected");
  await expect(dialog.getByRole("button", { name: "Remove venue" })).toBeVisible();
  await expect(dialog.getByLabel("Photo description")).toHaveValue("Friends outside");
  await dialog.getByLabel("Photo description").fill("Corrected friends outside");
  await dialog.getByRole("textbox", { name: "Post", exact: true }).fill("Edited draft survives");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Post changed. Your draft is still here.");
  await dialog.getByRole("button", { name: "Load latest" }).click();
  await expect(dialog.getByRole("alert")).toContainText("draft is unchanged");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Edited draft survives")).toBeVisible();
  await expect(page.getByText("Edited", { exact: true })).toBeVisible();
  expect(editPayloads[1]).toMatchObject({ expectedRevision: 2, photoAltText: "Corrected friends outside" });
  await page.getByRole("button", { name: "Edit post" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Post", exact: true })).toHaveValue("Edited draft survives");
  await expect(dialog.getByLabel("Selected Venue")).toBeVisible();
  await expect(dialog.getByLabel("Photo description")).toHaveValue("Corrected friends outside");
  await dialog.getByRole("button", { name: "Remove photo" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Edit post" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Photo description")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Edit post" })).toBeFocused();
});

test("account-bound drafts isolate text and photo while two tabs warn", async ({ context, page }) => {
  let scope = "a".repeat(43);
  await context.route("**/api/social/access", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: "verified", viewerHandle: "alice", draftScope: scope }) }));
  await context.route("**/api/social/interactions?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) }));
  await context.route("**/api/social/outbox", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));
  await context.route("**/api/social/tags", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals: [] }) }));
  await context.route("**/api/social/posts?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [], nextCursor: null }) }));
  await page.goto("/social"); await page.getByRole("button", { name: "New post" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Post", exact: true }).fill("Alice private draft");
  await dialog.getByLabel("Photo", { exact: true }).setInputFiles({ name: "alice.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await dialog.getByLabel("Photo description").fill("Alice photo");
  await page.waitForTimeout(400);
  const second = await context.newPage(); await second.goto("/social"); await second.getByRole("button", { name: "New post" }).click();
  await expect(second.getByRole("textbox", { name: "Post", exact: true })).toHaveValue("Alice private draft");
  await expect(second.getByLabel("Photo description")).toHaveValue("Alice photo");
  await expect(page.getByText("This draft is open in another tab.")).toBeVisible();
  scope = "b".repeat(43); await second.reload(); await second.getByRole("button", { name: "New post" }).click();
  dialog = second.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Post", exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Photo description")).toHaveCount(0);
});

for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1280, height: 900 }]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`${viewport.width}px ${colorScheme} composer has no overflow and passes keyboard and axe`, async ({ page }) => {
      await page.setViewportSize(viewport); await page.emulateMedia({ colorScheme, reducedMotion: "reduce" }); await mockVerified(page);
      await page.route("**/api/social/tags", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ proposals: [] }) }));
      await page.route("**/api/social/posts?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [basePost], nextCursor: null }) }));
      await page.goto("/social");
      const trigger = page.getByRole("button", { name: "New post" });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      const results = await new AxeBuilder({ page }).include(".socialComposer").analyze(); expect(results.violations).toEqual([]);
      if (process.env.PW_SOCIAL_COMPOSER_PROOF === "1") {
        const directory = join(process.cwd(), "docs/proof/social-composer"); mkdirSync(directory, { recursive: true });
        await page.screenshot({ path: join(directory, `${viewport.width}-${colorScheme}.png`), fullPage: false });
      }
      const focusableCount = await dialog.locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])').count();
      for (let index = 0; index < focusableCount + 2; index += 1) await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
}
