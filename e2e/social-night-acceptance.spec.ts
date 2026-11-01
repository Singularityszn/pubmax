import { expect, test, type Page } from "@playwright/test";

import { ACCOUNTS, accessJwt, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// Oracle: the approved social-night intent requires truthful filters, recoverable
// search, account isolation, and a strict composer modal. API doubles are only
// external boundaries. Every assertion drives the shipped browser application.
async function signedIn(page: Page) {
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await auth.signedInAs("A");
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  return auth;
}

async function social(page: Page) {
  await signedIn(page);
  await page.route("**/api/social/access", route => route.fulfill({ json: {
    state: "verified", viewerHandle: "karan", draftScope: "a".repeat(43),
  } }));
  await page.route("**/api/social/posts**", route => route.fulfill({ json: { posts: [], nextCursor: null } }));
  await page.route("**/api/social/interactions**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/social/outbox", route => route.fulfill({ json: { posts: [] } }));
  await page.route("**/api/social/tags**", route => route.fulfill({ json: { proposals: [], nextCursor: null } }));
}

const crews = ["planning", "live"].map((phase, index) => ({
  kind: "member", crewId: `50000000-0000-4000-8000-00000000000${index + 1}`,
  title: ["Friday in Camden", "Round at the Crown"][index], phase, nightArea: "Camden",
  startsAt: "2026-10-26T18:30:00.000Z",
  viewer: { memberId: "30000000-0000-4000-8000-000000000001", role: "member" },
}));

test("crew phase filters cover complete lists and disappear for incomplete lists", async ({ page }, info) => {
  await social(page);
  let partial = false;
  await page.route("**/api/social/crews", route => route.fulfill({ json: {
    items: crews, nextCursor: partial ? "more-crews" : null,
  } }));
  await page.goto("/social");
  const panel = page.getByRole("region", { name: "Your crews", exact: true });
  await panel.getByRole("button", { name: "Out now, 1 crew", exact: true }).click();
  await expect(panel.getByRole("link")).toHaveCount(1);
  await expect(panel.getByRole("link")).toContainText("Round at the Crown");
  await panel.getByRole("button", { name: "Done, 0 crews", exact: true }).click();
  await expect(panel.getByText("No crews match this filter.")).toBeVisible();
  await panel.getByRole("button", { name: "Show all crews" }).click();
  await expect(panel.getByRole("link")).toHaveCount(2);
  await panel.screenshot({ path: info.outputPath("crew-complete.png") });
  partial = true;
  await page.reload();
  await expect(panel.getByRole("link")).toHaveCount(2);
  await expect(panel.getByRole("group", { name: "Filter your crews" })).toHaveCount(0);
  await panel.screenshot({ path: info.outputPath("crew-incomplete.png") });
});

test("handle search shows loading and refusal, retries, and clears without following", async ({ page }, info) => {
  await social(page);
  let attempts = 0;
  let writes = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/profiles/search?**", async route => {
    attempts += 1;
    if (attempts === 1) {
      await held;
      await route.fulfill({ status: 503, json: { error: "Unavailable" } });
    } else await route.fulfill({ json: { matches: [{ id: "mate-1", handle: "alex", relation: "mates" }] } });
  });
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/follow")) writes += 1; });
  await page.goto("/social");
  // The lane moves from the door to the rail once the session resolves. Type
  // after that move, so the held first request belongs to the field under test.
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
  const panel = page.getByRole("region", { name: "Find your lot", exact: true });
  const field = panel.getByRole("searchbox", { name: "Search handles" });
  await field.fill("al");
  try { await expect(panel.getByText("Looking…", { exact: true })).toBeVisible(); }
  finally { release(); }
  await expect(panel.getByRole("alert")).toContainText("search right now");
  await panel.getByRole("button", { name: "Try search again" }).click();
  await expect(panel.getByRole("link", { name: /alex/ })).toBeVisible();
  await panel.screenshot({ path: info.outputPath("search-recovered.png") });
  await panel.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await expect(panel.getByRole("link", { name: /alex/ })).toHaveCount(0);
  expect(attempts).toBe(2);
  expect(writes).toBe(0);
});

test("composer traps keyboard focus, names public audience, and restores scroll and focus", async ({ page }, info) => {
  await social(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/social");
  const trigger = page.getByRole("button", { name: "Post", exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "New post", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Visibility", exact: true }).selectOption("public");
  await expect(dialog.getByText("Anyone on Social can see your words and photos. Only mutual friends can see the pub you tag.")).toBeVisible();
  const controls = dialog.locator('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]');
  await controls.last().focus();
  await page.keyboard.press("Tab");
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(controls.last()).toBeFocused();
  await page.screenshot({ path: info.outputPath("composer-public-focus.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(scroll);
});

test("inbox distinguishes delayed, failed, degraded and empty reads with recovery", async ({ page }, info) => {
  await signedIn(page);
  let mode = "held";
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/messages?**", async route => {
    if (mode === "held") { await held; await route.fulfill({ status: 503, json: { error: "Unavailable" } }); }
    else await route.fulfill({ json: mode === "degraded" ? {
      status: "degraded", conversations: [{ id: "unknown", otherHandle: "erin" }],
    } : { conversations: [] } });
  });
  await page.goto("/messages");
  try { await expect(page.getByText("With you in a sec.", { exact: true })).toBeVisible(); }
  finally { release(); }
  await expect(page.getByRole("complementary", { name: "Inbox", exact: true }).getByRole("alert")).toContainText("load your conversations");
  await page.screenshot({ path: info.outputPath("inbox-error.png") });
  mode = "degraded";
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".conversationLink")).toHaveCount(1);
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(page.getByText("Some unread counts couldn't be checked. Your conversations are in All.")).toBeVisible();
  await expect(page.getByText("You're up to date.", { exact: false })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("inbox-degraded-unread.png") });
  await page.getByRole("button", { name: "Show all conversations" }).click();
  await expect(page.locator(".conversationLink")).toHaveCount(1);
  mode = "empty";
  await page.reload();
  await expect(page.getByText("Your messages start here.", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("inbox-empty.png") });
});

test("switching accounts clears inbox search and filter without exposing the previous list", async ({ page }, info) => {
  const auth = await signedIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/messages?**", route => {
    const bearer = route.request().headers().authorization;
    const mine = bearer === "Bearer pubmaxx-e2e-access-token-A" || bearer === `Bearer ${accessJwt(ACCOUNTS.A)}`;
    return route.fulfill({ json: { conversations: [{
      id: mine ? "alice-only" : "bob-only", otherHandle: mine ? "maisie" : "erin", unread: mine ? 2 : 0,
    }] } });
  });
  await page.goto("/messages");
  await expect(page.locator('.conversationLink[href="/messages/alice-only"]')).toBeVisible();
  await auth.signedInAs("B");
  await page.reload();
  await expect(page.locator('.conversationLink[href="/messages/bob-only"]')).toBeVisible();
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search conversations" }).fill("nobody");
  await page.getByRole("button", { name: /Account options/ }).first().click();
  await page.getByRole("button", { name: "Switch account", exact: true }).click();
  await page.locator(".authSwitcherRow").filter({ hasText: `@${ACCOUNTS.A.handle}` }).click();
  await expect(page.getByRole("searchbox", { name: "Search conversations" })).toHaveValue("");
  await expect(page.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.conversationLink[href="/messages/bob-only"]')).toHaveCount(0);
  await expect(page.locator(".conversationLink")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("inbox-account-switched.png") });
});

test("social shortcuts open Messages, Pub Pal and planning through existing routes", async ({ page }) => {
  await social(page);
  for (const [label, path] of [["Messages", "/messages"], ["Your Pub Pal", "/pal"], ["Plan a crawl", "/plan"]]) {
    await page.goto("/social");
    await page.getByRole("navigation", { name: "Your night out", exact: true }).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator("main").first()).toBeVisible();
  }
});

test("rapid cheer and save actions cannot race and confirmed changes retain both states", async ({ page }, info) => {
  await social(page);
  const at = "2026-10-26T18:00:00.000Z";
  await page.route("**/api/social/posts**", route => route.fulfill({ json: { posts: [{
    id: "reaction-proof", kind: "standard", visibility: "friends", body: "A table in the pub garden.",
    area: "camden", venueId: null, venueName: null, hashtags: [], commentPolicy: "open", photo: null,
    moderationState: "approved", featureRequest: null, revision: 0, editedAt: null,
    createdAt: at, updatedAt: at, ownedByViewer: false, author: { handle: "alex" },
  }], nextCursor: null } }));
  let writes = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/social/interactions**", async route => {
    if (route.request().method() === "PUT") {
      writes += 1;
      if (writes === 1) await held;
      await route.fulfill({ json: { ok: true } });
    } else if (new URL(route.request().url()).searchParams.get("view") === "summary") {
      await route.fulfill({ json: { summary: { cheered: false, saved: false, cheerCount: 3 } } });
    } else await route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto("/social");
  const cheer = page.getByRole("button", { name: "Cheers 3", exact: true });
  await expect(cheer).toBeEnabled();
  await page.locator(".socialPostActions").evaluate(element => {
    const buttons = element.querySelectorAll<HTMLButtonElement>("button");
    buttons[0].click();
    buttons[2].click();
  });
  try {
    await expect(page.getByRole("button", { name: /^Cheers/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    expect(writes).toBe(1);
  } finally { release(); }
  await expect(page.getByRole("button", { name: "Cheers 4", exact: true })).toHaveAttribute("aria-pressed", "true");
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Cheers 4", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(writes).toBe(2);
  await page.locator(".socialPostCard").screenshot({ path: info.outputPath("reactions-confirmed.png") });
});

test("hiding the author keeps the public projection anonymous and removes pub fields from the composer", async ({ page }, info) => {
  await social(page);
  const at = "2026-10-26T18:00:00.000Z";
  await page.route("**/api/social/posts**", route => route.fulfill({ json: { posts: [{
    id: "hidden-proof", kind: "standard", visibility: "public", nameHidden: true,
    body: "A quiet corner for a catch-up.", area: "camden", venueId: null, venueName: null,
    hashtags: [], commentPolicy: "open", photo: null, moderationState: "approved", featureRequest: null,
    revision: 0, editedAt: null, createdAt: at, updatedAt: at, ownedByViewer: false, author: { handle: null },
  }], nextCursor: null } }));
  await page.goto("/social");
  const post = page.locator(".socialPostCard");
  await expect(post.getByText("a PUBMAXXER", { exact: true })).toBeVisible();
  await expect(post.locator('a[href^="/u/"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New post", exact: true });
  await dialog.getByRole("combobox", { name: "Visibility", exact: true }).selectOption("private");
  await dialog.getByRole("checkbox", { name: "Hide my name on this post", exact: true }).check();
  await expect(dialog.getByRole("combobox", { name: "Visibility", exact: true })).toHaveValue("public");
  await expect(dialog.getByRole("combobox", { name: "Visibility", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("textbox", { name: "Venue, friends only", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("hidden-name-composer.png") });
});

test("inbox search matches names, handles and group titles and combines with the selected filter", async ({ page }, info) => {
  await signedIn(page);
  await page.route("**/api/messages?**", route => route.fulfill({ json: { conversations: [
    { id: "maisie", otherHandle: "maisie_s", otherDisplayName: "Maisie", unread: 2 },
    { id: "tom", otherHandle: "tom_the_lamb", unread: 0 },
    { id: "friday", kind: "group", title: "Friday regulars", otherHandle: "tom", memberHandles: ["karan", "tom", "maisie_s"], unread: 0 },
  ] } }));
  await page.goto("/messages");
  const search = page.getByRole("searchbox", { name: "Search conversations" });
  const rows = page.locator(".conversationLink");
  await expect(rows).toHaveCount(3);
  await search.fill("Maisie");
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute("href", "/messages/maisie");
  await search.fill("tom_the");
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute("href", "/messages/tom");
  await search.fill("Friday");
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute("href", "/messages/friday");
  await page.getByRole("button", { name: "Groups", exact: true }).click();
  await search.fill("Maisie");
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("No conversations match your search.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute("href", "/messages/friday");
  await page.screenshot({ path: info.outputPath("inbox-search-and-filter.png") });
});
