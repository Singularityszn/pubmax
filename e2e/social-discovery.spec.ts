import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const postId = "11111111-1111-4111-8111-111111111111";
const mediaId = "22222222-2222-4222-8222-222222222222";
const fixturePost = {
  id: postId, kind: "standard", visibility: "public", body: "Live music with the people who make a Tuesday.",
  area: "camden", venueId: null, venueName: null, venueProjected: false,
  hashtags: ["livemusic"], commentPolicy: "open", photo: { mediaId, altText: "A bill from our night out" },
  moderationState: "approved", featureRequest: null, revision: 1, mutationVersion: 1,
  editedAt: null, createdAt: "2026-09-07T18:00:00Z", updatedAt: "2026-09-07T18:00:00Z",
  author: { handle: "night_owl" }, ownedByViewer: false,
};

async function prepareSocial(page: Page) {
  await page.addInitScript(() => {
    const id = "00000000-0000-4000-8000-000000000010";
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("sb-pubmaxx-e2e-auth-token", JSON.stringify({
      access_token: `pubmaxx-e2e-access-token-${id}`, refresh_token: "pubmaxx-e2e-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 86400, expires_in: 86400, token_type: "bearer",
      user: { id, aud: "authenticated", role: "authenticated", email: "social@example.test",
        app_metadata: {}, user_metadata: {}, created_at: "2026-07-29T00:00:00Z" },
    }));
  });
  await page.route("**/api/auth/session", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/identity/handle/current", route => route.fulfill({ json: { handle: "viewer", hasPassword: true } }));
  await page.route("**/api/identity/onboarding", route => route.fulfill({ json: { complete: true, handle: "viewer", dateOfBirth: "1995-03-21" } }));
  await page.route("**/api/social/access", route => route.fulfill({ json: { state: "verified", viewerHandle: "viewer", draftScope: "a".repeat(43) } }));
  await page.route("**/api/social/interactions?**", route => route.fulfill({ json: {
    items: [], comments: [], nextCursor: null,
    summary: { cheered: false, saved: false, reposted: false, cheerCount: 0, repostCount: 0 },
  } }));
  await page.route(`**/api/social/posts/${postId}`, route => route.fulfill({ json: { post: fixturePost } }));
  await page.route("**/api/social/outbox", route => route.fulfill({ json: { posts: [] } }));
  await page.route("**/api/social/tags**", route => route.fulfill({ json: { proposals: [], nextCursor: null } }));
  await page.route("**/api/social/crews**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route(`**/api/social/media/${mediaId}**`, route => route.fulfill({ json: { url: "/social-proof.jpg", kind: "photo", contentType: "image/jpeg" } }));
  await page.route("**/social-proof.jpg", route => route.fulfill({ path: "e2e/fixtures/bill.jpg", contentType: "image/jpeg" }));
}

test("discovery leads the phone feed and Following remains explicit", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareSocial(page);
  const reads: string[] = [];
  await page.route("**/api/social/posts?**", route => {
    const lane = new URL(route.request().url()).searchParams.get("lane")!;
    reads.push(lane);
    return route.fulfill({ json: { posts: lane === "following" ? [] : [fixturePost], nextCursor: null } });
  });
  await page.goto("/social");
  await expect(page.getByRole("heading", { name: "Good times, shared." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Post lanes" }).getByRole("link", { name: "Discover", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(fixturePost.body)).toBeVisible();
  expect(reads[0]).toBe("discover");
  await expect(page.getByRole("link", { name: "@night_owl", exact: true })).toHaveAttribute("href", "/u/night_owl");
  const positions = await page.evaluate(() => ({
    feed: document.querySelector(".socialMain")!.getBoundingClientRect().top,
    rail: document.querySelector(".socialControlRail")!.getBoundingClientRect().top,
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(positions.feed).toBeLessThan(positions.rail);
  expect(positions.width).toBeLessThanOrEqual(positions.viewport);
  await page.screenshot({ path: testInfo.outputPath("social-phone.png"), fullPage: true });
  await page.getByRole("navigation", { name: "Post lanes" }).getByRole("link", { name: "Following" }).click();
  await expect(page).toHaveURL(/feed=following/);
  await expect(page.getByRole("link", { name: "Discover moments" })).toBeVisible();
  await expect(page.getByText(fixturePost.body)).toHaveCount(0);
  expect(reads).toContain("following");
  await page.getByRole("link", { name: "Discover moments" }).click();
  await expect(page.getByText(fixturePost.body)).toBeVisible();
});

test("Nearby requests a chosen area and layout remains accessible in both themes", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await prepareSocial(page);
  const reads: string[] = [];
  await page.route("**/api/social/posts?**", route => {
    reads.push(route.request().url());
    return route.fulfill({ json: { posts: [fixturePost], nextCursor: null } });
  });
  await page.goto("/social?feed=nearby");
  await expect(page.getByRole("combobox", { name: "Nearby area" })).toBeVisible();
  expect(reads).toHaveLength(0);
  await page.getByRole("combobox", { name: "Nearby area" }).selectOption("camden");
  await expect(page.getByText(fixturePost.body)).toBeVisible();
  expect(reads.every(url => new URL(url).searchParams.get("area") === "camden")).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    const results = await new AxeBuilder({ page }).include(".socialPage").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`social-desktop-${theme}.png`), fullPage: true });
  }
});

test("a real MP4 plays on demand and pauses outside the viewport", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareSocial(page);
  await page.route(`**/api/social/media/${mediaId}**`, route => route.fulfill({ json: {
    url: "/social-proof.mp4", kind: "video", contentType: "video/mp4",
  } }));
  await page.route("**/social-proof.mp4", route => route.fulfill({ path: "__tests__/fixtures/social-video-faststart.mp4", contentType: "video/mp4" }));
  await page.route("**/api/social/posts?**", route => route.fulfill({ json: {
    posts: [{ ...fixturePost, photo: { mediaId, altText: "A short clip from the night", kind: "video", contentType: "video/mp4" } }],
    nextCursor: null,
  } }));
  await page.goto("/social");
  const video = page.locator(".socialPostPhoto video");
  await expect(video).toBeVisible();
  await expect(video).toHaveJSProperty("autoplay", false);
  await expect(video).toHaveJSProperty("playsInline", true);
  await expect(video).toHaveJSProperty("paused", true);
  await video.evaluate(async element => { element.muted = true; await element.play(); });
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(video).toHaveJSProperty("paused", true);
});
