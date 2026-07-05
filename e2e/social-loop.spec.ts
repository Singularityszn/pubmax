import { test, expect, type Page } from "@playwright/test";

// Social-loop E2E (cc_plan2 §8/§9/§11). A READ-ONLY journey through the durable
// social surfaces — feed, pint permalink, crawl poster. It asserts the loop
// RENDERS correctly (real pub names, shareable posts, working cross-links)
// WITHOUT mutating anything: it never POSTs a drop/reaction/comment, so it is
// safe against the production Supabase env that `next start` boots with.
//
// Style matches e2e/smoke.spec.ts: watchPageErrors on deterministic surfaces,
// status-200 + a stable selector + errors.toEqual([]). Every content assertion
// is guarded by .count() so the suite is green on BOTH a populated feed and an
// empty DB — an empty feed is a valid state, never a failure. No waitForTimeout
// sleeps anywhere; only web-first (auto-retrying) assertions.

// Collect uncaught page errors so a single console-fatal fails the run loudly.
function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// A raw internal venue id looks like "venue-16pnwmm". The feed's honesty
// guarantee (§9) is that a card links the pub by NAME, never leaking this id as
// visible text. This regex must NOT match the rendered venue link text.
const RAW_VENUE_ID = /^venue-[a-z0-9]+$/;

test("feed shows real pub names, is shareable, and links to the map (§9/§11)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);

  // Deterministic scaffold: the feed heading always renders (loading, ready, or
  // the empty state), so wait on it before branching on card presence.
  await expect(page.locator(".feedTitle")).toBeVisible();

  const cards = page.locator(".feedCard:not(.feedCardSkeleton)");
  // Web-first wait for EITHER real cards OR the social empty state, so we never
  // branch on a mid-load snapshot (skeletons carry .feedCardSkeleton).
  await expect
    .poll(async () => (await cards.count()) + (await page.locator(".feedEmpty").count()))
    .toBeGreaterThan(0);

  const cardCount = await cards.count();
  if (cardCount > 0) {
    const first = cards.first();

    // The venue is linked by its human name, never the raw internal id.
    const link = first.locator(".feedVenueLink").first();
    await expect(link).toBeVisible();
    const name = (await link.innerText()).trim();
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toMatch(RAW_VENUE_ID);

    // …and that name links to the map with this pub selected (/map?sel=…).
    const href = await link.getAttribute("href");
    expect(href ?? "").toMatch(/^\/map\?sel=/);

    // Every pint is its own shareable post: a permalink (/p/…) + a share strip.
    const permalink = first.locator(".feedPermalink").first();
    await expect(permalink).toHaveAttribute("href", /^\/p\//);
    await expect(first.locator(".feedCardFooter .shareBar").first()).toBeVisible();
  } else {
    // Empty DB is a valid state — assert the social empty state, never fail.
    await expect(page.locator(".feedEmpty")).toBeVisible();
    await expect(page.locator(".feedEmpty .feedEmptyCta")).toHaveAttribute("href", /\/map/);
  }

  expect(errors).toEqual([]);
});

test("feed → map: clicking a pub name opens the map with it selected", async ({ page }) => {
  await page.goto("/feed");
  await expect(page.locator(".feedTitle")).toBeVisible();

  const cards = page.locator(".feedCard:not(.feedCardSkeleton)");
  await expect
    .poll(async () => (await cards.count()) + (await page.locator(".feedEmpty").count()))
    .toBeGreaterThan(0);

  const link = page.locator(".feedVenueLink").first();
  if ((await link.count()) === 0) {
    // No cards to navigate from (empty feed) — nothing to assert here; the
    // shape of the link is covered by the test above. Skip cleanly.
    test.skip(true, "empty feed: no venue link to navigate from");
    return;
  }

  await link.click();
  await expect(page).toHaveURL(/\/map\?sel=/);
});

test("pint permalink is a real shareable post; unknown id stays friendly (§8)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  // A known seed id (lib/pintDropSeeds.ts). Seeds are merged into every read
  // path, so this resolves to a real memory card on both in-memory and Supabase.
  const response = await page.goto("/p/seed-prospect-1");
  expect(response?.status()).toBe(200);

  // The collectible memory card is present…
  await expect(page.locator(".permalink__mat")).toBeVisible();
  // …with a share strip so the pint can travel into a group chat…
  await expect(page.locator(".permalink__share .shareBar")).toBeVisible();
  // …and a working way back onto the map (the pub link).
  await expect(page.locator(".permalink__ghost")).toHaveAttribute("href", /\/map/);

  expect(errors).toEqual([]);

  // A hidden/unknown id must still render a friendly state — 200, no crash, and
  // a route back to the feed (never a leak of moderation state).
  const missingErrors = watchPageErrors(page);
  const missing = await page.goto("/p/definitely-not-real");
  expect(missing?.status()).toBe(200);
  await expect(page.locator(".permalink--empty")).toBeVisible();
  await expect(
    page.locator(".permalink--empty").getByRole("link", { name: /feed/i }),
  ).toHaveAttribute("href", "/feed");
  expect(missingErrors).toEqual([]);
});

test("crawl surfaces render; unknown slug is a friendly 404/empty", async ({ page }) => {
  const errors = watchPageErrors(page);

  // The crawls index always mounts (client component; decode never throws) — it
  // shows a poster (from ?s=) or the empty state. Either way the shell renders.
  const index = await page.goto("/crawls");
  expect(index?.status()).toBe(200);
  await expect(page.locator(".crawlsShell")).toBeVisible();
  // Exactly one of the two states is present.
  await expect
    .poll(async () =>
      (await page.locator(".crawlPoster").count()) + (await page.locator(".crawlEmpty").count()),
    )
    .toBeGreaterThan(0);

  expect(errors).toEqual([]);

  // An unknown slug calls notFound() → Next's 404. It must render the friendly
  // not-found page (a stable 404 status) rather than crashing the route.
  const missing = await page.goto("/crawls/no-such-slug");
  expect(missing?.status()).toBe(404);
  // The document still parses to a real page (a body with content), not a blank
  // white screen — a cheap, WebGL-agnostic proof the 404 surface renders.
  await expect(page.locator("body")).not.toBeEmpty();
});
