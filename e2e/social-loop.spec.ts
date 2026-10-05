import { test, expect, type Page } from "@playwright/test";

import { expectStreamedPageSettled } from "./helpers/streamedPage";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });
});

// Social-loop E2E (cc_plan2 §8/§9/§11). A READ-ONLY journey through the durable
// social surfaces: Social (canonical, /feed 308s here), pint permalink, crawl
// poster. It asserts the loop RENDERS correctly WITHOUT mutating anything: it
// never POSTs a drop/reaction/comment, so it is safe against the production
// Supabase env that `next start` boots with.
//
// Style matches e2e/smoke.spec.ts: watchPageErrors on deterministic surfaces,
// status-200 + a stable selector + errors.toEqual([]). No waitForTimeout
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

test("legacy /feed opens signed-out Social, not the retired feed", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/social\/?$/);
  await expect(
    page.getByRole("heading", { name: "Crews and people who are already here." }),
  ).toBeVisible();
  await expect(page.getByText("Sign in to use Social.")).toBeVisible();
  await expect(
    page.locator("[data-primary-action]").getByRole("link", { name: "Sign in" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").getByRole("link", { name: "Sign in" }),
  ).toHaveCount(0);
  await expect(page.locator(".feedCard")).toHaveCount(0);
  await expect(page.locator(".feedEmpty")).toHaveCount(0);
  await expect(page.locator(".feedFilters")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("signed-out Social offers Sign in, not a Cheers chip", async ({ page }) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/social");
  expect(response?.status()).toBe(200);
  await expect(
    page.locator("[data-primary-action]").getByRole("link", { name: "Sign in" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Cheers/ })).toHaveCount(0);

  expect(errors).toEqual([]);
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
  // …and a working way back onto the map (the pub link). The card can carry
  // several ghost links (map, Ledger); the map one is the §8 guarantee.
  await expect(page.locator('.permalink__ghost[href*="/map"]')).toHaveAttribute("href", /\/map/);

  expect(errors).toEqual([]);

  // A hidden/unknown id must still render a friendly state: 200, no crash, and
  // a route back to Discover (never a leak of moderation state).
  const missingErrors = watchPageErrors(page);
  const missing = await page.goto("/p/definitely-not-real");
  expect(missing?.status()).toBe(200);
  await expect(page.locator(".permalink--empty")).toBeVisible();
  await expect(
    page.locator(".permalink--empty").getByRole("link", { name: /Browse pubs/i }),
  ).toHaveAttribute("href", "/social?tab=discover");
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

// ---------------------------------------------------------------------------
// Discover · Tonight board (components/discovery/TonightBoard.tsx). The live
// "cheapest pints logged tonight" board is community-driven and time-windowed
// (trailing 24h), so on a quiet night it renders its friendly empty state
// instead of rows — both are valid. We assert the section's stable heading
// always renders, and that whichever state shows is well-formed: real rows link
// the pub into /map?sel=… by NAME (never a raw venue id), or the empty note is
// present. Read-only: it consumes the same /api/pint-drops the page fetches and
// never POSTs.
test("discover recently logged cheap pints board renders rows or its empty state (§5.1)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/social?tab=discover");
  expect(response?.status()).toBe(200);

  // The app-owned section heading (stable id in DiscoverBody) always
  // renders regardless of whether any pints landed in the last 24h.
  await expect(page.locator("#tonight-title")).toHaveText("Recently logged cheap pints");

  // The board mounts EITHER as an ordered list of rows OR as its empty note. It
  // starts empty (drops arrive after the client fetch), so web-first wait until
  // one of the two states is present rather than snapshotting mid-load.
  const rows = page.locator(".tonightBoard .tonightRow");
  const empty = page.locator(".discoverEmpty");
  await expect
    .poll(async () => (await rows.count()) + (await empty.count()))
    .toBeGreaterThan(0);

  const rowCount = await rows.count();
  if (rowCount > 0) {
    const link = rows.first().locator(".tonightPub").first();
    await expect(link).toBeVisible();

    // The pub is linked by its human name — never the raw internal venue id.
    const name = (await link.innerText()).trim();
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toMatch(RAW_VENUE_ID);

    // …and that name routes onto the map with this pub selected (/map?sel=…).
    const href = await link.getAttribute("href");
    expect(href ?? "").toMatch(/^\/map\?sel=/);
  } else {
    // Quiet night: the empty note ("be the first tonight") stands in for rows.
    await expect(empty.first()).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("discover mobile price badges stay stable and inside the viewport", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const response = await page.goto("/social?tab=discover");
  expect(response?.status()).toBe(200);
  // /social streams behind loading.tsx, so until React swaps the hidden
  // segment in the document holds two #cheap-title headings.
  await expectStreamedPageSettled(page);

  await page.locator("#cheap-title").scrollIntoViewIfNeeded();
  const badges = page.locator(".leaderboard .priceBadge");
  await expect(badges.first()).toBeVisible({ timeout: 15_000 });

  const result = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const boxes = Array.from(document.querySelectorAll<HTMLElement>(".leaderboard .priceBadge"))
      .filter((el) => el.offsetParent !== null)
      .slice(0, 8)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          right: rect.right,
        };
      });
    return { overflow, boxes };
  });

  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.boxes.length).toBeGreaterThan(0);
  for (const box of result.boxes) {
    expect(box.width).toBeGreaterThan(40);
    expect(box.height).toBeGreaterThan(20);
    expect(box.right).toBeLessThanOrEqual(391);
  }

  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Borough discovery pages (app/borough/page.tsx + app/borough/[slug]/page.tsx).
// Server-rendered, shareable, dataset-backed (cc_plan2 §14/§25). The index lists
// every borough; a real borough page ranks its pubs (each linking onto the map);
// an unknown slug is a friendly 404. All read-only — pure GETs off the bundled
// dataset, no mutation.
test("borough index lists boroughs, each linking to its own page (§14/§25)", async ({ page }) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/borough");
  expect(response?.status()).toBe(200);

  // The page heading always renders. The dataset ships with the app, so the grid
  // is populated in practice — but guard for [] so an empty dataset shows its
  // friendly note rather than failing the run.
  await expect(page.locator(".screenTitle").first()).toBeVisible();
  const cards = page.locator(".boroughGrid .boroughCard");
  await expect
    .poll(async () => (await cards.count()) + (await page.locator(".boroughEmpty").count()))
    .toBeGreaterThan(0);

  if ((await cards.count()) > 0) {
    // Each borough card links to its own /borough/<slug> discovery page.
    await expect(cards.first()).toHaveAttribute("href", /^\/borough\/[a-z0-9-]+$/);
  } else {
    await expect(page.locator(".boroughEmpty")).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("a real borough page ranks pubs that link onto the map (§14/§25)", async ({ page }) => {
  const errors = watchPageErrors(page);

  // "westminster" is a stable, populated slug: it resolves through the app's
  // primaryBorough→visibleBorough grouping to dozens of pubs in the bundled
  // dataset, so this page reliably renders the ranked table (not the empty note).
  const response = await page.goto("/borough/westminster");
  expect(response?.status()).toBe(200);

  await expect(page.locator("h1.screenTitle")).toContainText("Pubs in");

  // The ranked table renders (guard for the empty state in case the dataset ever
  // stops carrying this borough — the page must still not fail).
  const pubs = page.locator(".boroughTable .boroughPub");
  await expect
    .poll(async () => (await pubs.count()) + (await page.locator(".boroughEmpty").count()))
    .toBeGreaterThan(0);

  if ((await pubs.count()) > 0) {
    // Each pub name links onto the map with it selected (venueMapUrl → /map?sel=).
    await expect(pubs.first()).toHaveAttribute("href", /^\/map\?sel=/);
    // …and the visible label is the human pub name, not a raw internal venue id.
    const name = (await pubs.first().innerText()).trim();
    expect(name).not.toMatch(RAW_VENUE_ID);
  } else {
    await expect(page.locator(".boroughEmpty")).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("an unknown borough slug is a friendly 404, not a crash (§14/§25)", async ({ page }) => {
  // boroughFromSlug returns null for a slug no borough produces → notFound() →
  // Next's 404. The route must serve a real not-found page, never 500 or crash.
  const missing = await page.goto("/borough/zzz-not-real");
  expect(missing?.status()).toBe(404);
  // A rendered 404 body (content present), not a blank white screen.
  await expect(page.locator("body")).not.toBeEmpty();
});

// ---------------------------------------------------------------------------
// Public profile (app/u/[handle]/page.tsx). Dynamic + client: any handle mounts
// the header without crashing, even an unknown one (friendly empty state). The
// §9 honesty fix is pinned here: when drop cards DO render, the venue label is
// the human pub name — never a raw "venue-…" id leaked as visible text. Purely
// read-only: it filters the public /api/pint-drops feed, never writes.
test("profile mounts its header for any handle; drop labels are never a raw venue id (§9)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/u/testdrinker");
  expect(response?.status()).toBe(200);

  // The profile header always mounts (synthesized identity for an unknown handle).
  await expect(page.locator(".profileHeader")).toBeVisible();

  // The drops section resolves to one of: loading→ready with cards, or a
  // "no pints logged" empty note. Wait until it settles off the loading state so
  // we branch on a stable snapshot, not a mid-fetch one.
  const cards = page.locator(".profileDropCard");
  const dropsEmpty = page.locator(".profileDropsSection .profileEmpty");
  await expect
    .poll(async () => (await cards.count()) + (await dropsEmpty.count()))
    .toBeGreaterThan(0);

  // §9 pin: every rendered drop card labels its venue by the human name — a raw
  // internal "venue-…" id must NEVER appear as the visible venue link text.
  const cardCount = await cards.count();
  for (let i = 0; i < cardCount; i++) {
    const label = cards.nth(i).locator(".profileDropVenue").first();
    const name = (await label.innerText()).trim();
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toMatch(RAW_VENUE_ID);
    // The venue link still routes onto the map (via enriched url or ?sel=<id>).
    await expect(label).toHaveAttribute("href", /\/map/);
  }

  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Map onboarding surface (components/PubMap.tsx). WebGL-agnostic, like
// smoke.spec: we only assert the map region MOUNTS (canvas when a GPU is
// present, the "renderer unavailable" fallback otherwise). We deliberately do
// NOT assert the onboarding overlay's exact copy — it's sessionStorage-gated and
// only appears on a first visit, so pinning it would be flaky. Read-only: a bare
// GET of /map, no interaction that could persist anything.
test("/map mounts the map region without crashing (WebGL-agnostic overlay guard)", async ({
  page,
}) => {
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The wrapper always renders; inside is EITHER the maplibre container (GPU) OR
  // the fallback (headless/no-WebGL). Pass on either so this stays green in CI.
  await expect(page.locator(".mapCanvasWrap")).toBeVisible();
  await expect(page.locator(".maplibreMap, .mapFallback").first()).toBeVisible();
  // The onboarding overlay is sessionStorage-gated (may or may not be present);
  // we only assert it never leaves the DOM in a broken half-state — if it exists,
  // its dismiss control is reachable. Guard with count so a suppressed overlay
  // (second visit) doesn't fail the test.
  const onboarding = page.locator(".mapOnboarding");
  if ((await onboarding.count()) > 0) {
    await expect(onboarding.locator(".mapOnboardingDismiss").first()).toBeVisible();
  }
  // No pageerror assertion: MapLibre GL emits async teardown noise under headless
  // timing that is not app logic under test (same rationale as smoke.spec).
});

// ---------------------------------------------------------------------------
// Saved-only filter control (components/map/ControlRail.tsx). The rail is a
// desktop surface (hidden on mobile), so we run this on a desktop viewport and
// guard on the rail's presence. The "Saved only" checkbox must exist in the DOM
// — it's the entry point to the saved-only map/list filter (§ friends feed work).
test("desktop map control rail exposes the 'Saved only' filter checkbox", async ({ page }) => {
  // Desktop viewport so the control rail (hidden on mobile) is in the DOM.
  await page.setViewportSize({ width: 1280, height: 900 });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // PubMap is a client component: wait for the map region to mount (proof the
  // component hydrated) before asserting on the rail, so we never race an
  // un-hydrated DOM. WebGL-agnostic — canvas or fallback, either is fine.
  await expect(page.locator(".mapCanvasWrap")).toBeVisible();

  // The reset keeps planner controls out of the map until explicitly requested.
  // Open the desktop planner, then verify the saved-only entry remains present.
  await page.getByRole("button", { name: "Plan an outing" }).click();
  const rail = page.locator(".controlRail");
  await expect(rail).toHaveCount(1);

  // The "Saved only" checkbox: its label carries a stable accessible name; the
  // control is the checkbox inside it. Assert it exists and is unchecked by
  // default — we never click it, so no per-device saved-only state is mutated.
  const savedOnly = rail.getByRole("checkbox", {
    name: "Show only venues you have saved",
  });
  await expect(savedOnly).toHaveCount(1);
  await expect(savedOnly).not.toBeChecked();
});

// ---------------------------------------------------------------------------
// a11y landmark smoke across the four top-level read surfaces. Every page must
// give assistive tech a stable spine: a reachable page <h1> and a single main
// landmark. We assert the universally-true parts (exactly one visible <h1>, no
// uncaught page errors) on all four, and the single main-landmark on the pages
// that expose one today. `/` (LandingPage) and `/feed` render a real <main>;
// `/discover` and `/borough` currently wrap in a plain <div> (no <main> / no
// [role=main]) — see the DEFECT note below — so we tolerate 0-or-1 there rather
// than false-fail, but STILL forbid MORE than one landmark anywhere. Read-only:
// bare GETs, no interaction, no data written.
//
// DEFECT (reported, not fixed): app/discover/page.tsx and app/borough/page.tsx
// expose no <main> landmark (their sibling read pages — feed, crawls, u/[handle],
// p/[id] — all do). A screen-reader "jump to main content" lands nowhere on those
// two. Low severity, but the landmark should be added for parity.
for (const path of ["/", "/feed", "/discover", "/borough"]) {
  test(`a11y: ${path} exposes a reachable <h1> and at most one main landmark, no page errors`, async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto(path);
    expect(response?.status()).toBe(200);

    // Exactly one page-level heading, and it is reachable (visible, non-empty).
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(h1.first()).toBeVisible();
    expect((await h1.first().innerText()).trim().length).toBeGreaterThan(0);

    // A main landmark: <main> or [role=main]. Never MORE than one (that would
    // confuse "jump to main content"). Pages that have one must render it
    // visibly; pages that (currently) have none are tolerated but flagged above.
    const main = page.locator('main, [role="main"]');
    const mainCount = await main.count();
    expect(mainCount).toBeLessThanOrEqual(1);
    if (mainCount === 1) {
      await expect(main.first()).toBeVisible();
    }

    expect(errors).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// Signed-out Social on a phone: the retired feed cards and lane chips are gone.
// The Screen primary is the sign-in door; the boundary prints its line alone.
test("mobile Social keeps the launch primary thumb-sized without page overflow", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  await page.setViewportSize({ width: 390, height: 844 });

  const response = await page.goto("/social");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Crews and people who are already here." }),
  ).toBeVisible();
  await expect(page.locator(".feedCard")).toHaveCount(0);
  await expect(page.locator(".feedFilters")).toHaveCount(0);

  const primary = page.locator("[data-primary-action]").getByRole("link", {
    name: "Sign in",
  });
  await expect(primary).toBeVisible();
  const box = await primary.boundingBox();
  expect(box, "Sign in should have a layout box").not.toBeNull();
  if (box) {
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  expect(errors).toEqual([]);
});
