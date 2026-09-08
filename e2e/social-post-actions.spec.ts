import { expect, test, type Page } from "@playwright/test";

const postId = "11111111-1111-4111-8111-111111111111";
const post = {
  id: postId, kind: "standard", visibility: "public", body: "An evening worth sharing.",
  area: null, venueId: null, venueName: null, venueProjected: false,
  hashtags: [], commentPolicy: "open", photo: null, moderationState: "approved",
  featureRequest: null, revision: 1, mutationVersion: 1, editedAt: null,
  createdAt: "2026-09-07T18:00:00Z", updatedAt: "2026-09-07T18:00:00Z",
  author: { handle: "night_owl" }, ownedByViewer: false,
};

async function prepare(page: Page, posts = [post]) {
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
  await page.route("**/api/social/posts?**", route => route.fulfill({ json: { posts, nextCursor: null } }));
  await page.route("**/api/social/outbox", route => route.fulfill({ json: { posts: [] } }));
  await page.route("**/api/social/tags**", route => route.fulfill({ json: { proposals: [], nextCursor: null } }));
  await page.route("**/api/social/crews**", route => route.fulfill({ json: { crews: [], nextCursor: null } }));
  const postReads: string[] = [];
  await page.route("**/api/social/posts/*", route => {
    expect(route.request().headers().authorization).toMatch(/^Bearer pubmaxx-e2e-access-token-/);
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    postReads.push(id);
    return route.fulfill({ json: { post: posts.find(item => item.id === id) } });
  });
  return postReads;
}

test("Cheer, comment retry and reporting use authenticated routes and confirmed replies on a phone", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const postReads = await prepare(page);
  let cheered = false;
  const methods: string[] = [];
  const commentKeys: string[] = [];
  await page.route("**/api/social/interactions**", route => {
    const request = route.request();
    expect(request.headers().authorization).toMatch(/^Bearer pubmaxx-e2e-access-token-/);
    methods.push(request.method());
    const view = new URL(request.url()).searchParams.get("view");
    if (request.method() === "GET") {
      if (view === "summary") return route.fulfill({ json: { summary: { cheered, saved: false, reposted: false, cheerCount: cheered ? 8 : 7, repostCount: 0 } } });
      if (view === "comments" || view === "notifications") return route.fulfill({ json: { items: [], nextCursor: null } });
      throw new Error(`Unexpected interaction read: ${request.url()}`);
    }
    if (request.method() === "POST") {
      if (request.postDataJSON().action === "report") {
        expect(request.postDataJSON()).toEqual({ action: "report", kind: "post", id: postId, reason: "spam" });
        return route.fulfill({ status: 202, json: { report: { id: "report-1", createdAt: post.createdAt } } });
      }
      expect(request.postDataJSON()).toEqual({ action: "comment", postId, body: "See you there" });
      commentKeys.push(request.headers()["idempotency-key"]);
      if (commentKeys.length === 1) return route.abort("failed");
      return route.fulfill({ status: 202, json: { comment: {
        id: "comment-1", postId, body: "See you there", author: { handle: "viewer" },
        moderationState: "pending", createdAt: post.createdAt,
      } } });
    }
    expect(["PUT", "DELETE"]).toContain(request.method());
    expect(request.postDataJSON()).toEqual({ action: "desired", postId, kind: "cheer" });
    cheered = request.method() === "PUT";
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/social");
  const actions = page.locator(".socialPostActions");
  await actions.scrollIntoViewIfNeeded();
  const cheer = actions.getByRole("button", { name: /Cheer/ });
  await expect(cheer).toHaveAttribute("aria-pressed", "false");
  expect(methods.every(method => method === "GET")).toBe(true);
  await cheer.click();
  await expect(cheer).toHaveAttribute("aria-pressed", "true");
  await expect(cheer).toContainText("8");
  await cheer.click();
  await expect(cheer).toHaveAttribute("aria-pressed", "false");
  const readsBeforeComments = postReads.length;
  await actions.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(actions.getByLabel("Add a comment")).toBeVisible();
  expect(postReads.length).toBeGreaterThan(readsBeforeComments);
  await actions.getByLabel("Add a comment").fill("See you there");
  await actions.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(actions.getByRole("alert")).toBeVisible();
  await expect(actions.getByLabel("Add a comment")).toHaveValue("See you there");
  await actions.getByRole("button", { name: "Retry comment", exact: true }).click();
  await expect(actions.getByRole("status")).toContainText("Comment received. It will appear after review.");
  expect(commentKeys).toHaveLength(2);
  expect(commentKeys[0]).toBe(commentKeys[1]);
  expect(commentKeys[0]).toBeTruthy();
  await expect(actions.locator("li")).toHaveCount(0);
  await actions.locator("summary").click();
  await actions.getByLabel("Report reason").selectOption("spam");
  await actions.getByRole("button", { name: "Report post", exact: true }).click();
  await expect(actions.getByText("Report received.", { exact: true })).toBeVisible();
  const sizes = await actions.locator("button:visible, textarea:visible, summary:visible, select:visible").evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(sizes.every(size => size.width >= 44 && size.height >= 44)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("offscreen posts do not request interaction summaries", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const posts = Array.from({ length: 20 }, (_, index) => ({ ...post,
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    createdAt: new Date(Date.parse(post.createdAt) - index * 60_000).toISOString(),
    body: `Evening ${index + 1}. ${"A walk with friends and a place to catch up. ".repeat(10)}`,
  }));
  await prepare(page, posts);
  const summaries = new Set<string>();
  await page.route("**/api/social/interactions**", route => {
    expect(route.request().method()).toBe("GET");
    expect(route.request().headers().authorization).toMatch(/^Bearer pubmaxx-e2e-access-token-/);
    const query = new URL(route.request().url()).searchParams;
    if (query.get("view") === "notifications") return route.fulfill({ json: { items: [], nextCursor: null } });
    expect(query.get("view")).toBe("summary");
    const id = query.get("postId");
    expect(posts.some(item => item.id === id)).toBe(true);
    summaries.add(id!);
    return route.fulfill({ json: { summary: { cheered: false, saved: false, reposted: false, cheerCount: 7, repostCount: 0 } } });
  });
  await page.goto("/social");
  await expect(page.locator(".socialPostActions")).toHaveCount(20);
  const lastPost = posts.at(-1)!;
  const lastCard = page.locator(".socialPostCard").last();
  await expect(lastCard).toContainText(lastPost.body);
  const first = page.locator(".socialPostActions").first();
  await first.scrollIntoViewIfNeeded();
  await expect(first.getByRole("button", { name: /Cheer/ })).toHaveAttribute("aria-pressed", "false");
  const last = lastCard.locator(".socialPostActions");
  await expect(last).not.toBeInViewport();
  expect(summaries.has(lastPost.id)).toBe(false);
  expect(summaries.size).toBeLessThan(20);
  await last.scrollIntoViewIfNeeded();
  await expect(last.getByRole("button", { name: /Cheer/ })).toHaveAttribute("aria-pressed", "false");
  expect(summaries.has(lastPost.id)).toBe(true);
});
