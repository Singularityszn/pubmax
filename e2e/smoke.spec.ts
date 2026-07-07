import { test, expect, type Page } from "@playwright/test";

// P3.11 smoke suite. High-signal, non-flaky, WebGL-agnostic: nothing here asserts
// that the MapLibre canvas actually paints (headless boxes have no GPU), only
// that the observable app scaffolding mounts and the honesty/theme guarantees hold.

// Collect uncaught page errors so a single console-fatal fails the run loudly.
function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("landing / serves, shows hero + Example honesty label + a working /map CTA", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  // Hero headline (stable id in components/landing/LandingPage.tsx).
  await expect(page.locator("#hero-title")).toContainText("Bring back");

  // Honesty guarantee: sample cards are labelled "Example".
  await expect(page.getByText("Example").first()).toBeVisible();

  // A working CTA to the planner. There are several "Open the map" links; take
  // the first and assert it points at /map, then that following it lands there.
  const cta = page.getByRole("link", { name: /open the map/i }).first();
  await expect(cta).toHaveAttribute("href", /\/map/);
  await cta.click();
  await expect(page).toHaveURL(/\/map/);

  expect(errors).toEqual([]);
});

test("landing hero headline renders the display face at a deliberate (>=600) weight", async ({
  page,
}) => {
  // Regression guard for the "font looks thin" defect: Space Grotesk is a
  // variable font, so a heading with no explicit font-weight falls to the 400
  // default and reads thin. The base h1/h2/h3 rules in globals.css set 600 —
  // assert the computed weight so a future revert (e.g. a co-dev overwrite)
  // fails loudly. Also assert the display face is actually wired: the computed
  // family must name Space Grotesk (guards against --font-display losing its
  // next/font wiring or --serif being repointed at a fallback stack).
  await page.goto("/");
  const hero = page.locator("#hero-title");
  await expect(hero).toBeVisible();
  await page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready);
  const { weight, family } = await hero.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { weight: parseInt(cs.fontWeight, 10), family: cs.fontFamily };
  });
  expect(weight).toBeGreaterThanOrEqual(600);
  expect(family).toMatch(/Space Grotesk/i);
});

test("/map mounts the map region (canvas OR fallback)", async ({ page }) => {
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The map is a dynamic import (ssr:false) behind a loading shell, slow to
  // hydrate under 4-worker parallel load — give it room so this doesn't flake.
  // The wrapper always renders once PubMap mounts; inside it is EITHER the
  // maplibre container (GPU present) OR the "Map renderer unavailable" fallback
  // (headless/no-WebGL). Pass on either so it stays green regardless of GPU.
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20000 });
  const canvasOrFallback = page.locator(".maplibreMap, .mapFallback").first();
  await expect(canvasOrFallback).toBeVisible({ timeout: 20000 });

  // ponytail: no pageerror assertion here. MapLibre GL emits async teardown
  // errors under headless timing (getLayer on a torn-down style) that are not
  // caused by app logic under test; the landing-page test above owns the
  // no-uncaught-errors guarantee on a deterministic surface.
});

test("/feed mounts the social feed scaffold without uncaught errors", async ({ page }) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);
  // The feed fetches /api/pint-drops and degrades to a social empty state on
  // failure, so we assert the always-present scaffold (site nav), not content.
  await expect(page.getByRole("link", { name: "Map", exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("/feed exposes the For You lane control (issue #36)", async ({ page }) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);
  // The lane switcher is always rendered (FeedFilters), independent of feed
  // content — assert the new For-You chip is present and pressable.
  const forYou = page.getByRole("button", { name: /for you/i }).first();
  await expect(forYou).toBeVisible();
  await forYou.click();
  await expect(forYou).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("/bar-tab/[id] renders the venue Bar Tab for a real venue id (issue #36)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  // Deep-link straight to a known seed pub's Bar Tab via the same stable FNV-1a
  // id helper the venue-sheet test uses — no canvas pin click needed.
  const response = await page.goto(`/bar-tab/${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);
  // The header eyebrow is app-owned + stable ("The Bar Tab"); the venue name and
  // "Open on the map" cross-link always render for a resolvable id.
  await expect(page.getByText("The Bar Tab", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /open on the map/i }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("/discover renders the cheap-pint leaderboard section", async ({ page }) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/discover");
  expect(response?.status()).toBe(200);
  // Stable, app-owned heading (id in app/discover/page.tsx).
  await expect(page.locator("#cheap-title")).toBeVisible();
  expect(errors).toEqual([]);
});

test("/u/[handle] renders a public profile for any handle without crashing", async ({ page }) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/u/testdrinker");
  expect(response?.status()).toBe(200);
  // Dynamic route: the scaffold always mounts even for an unknown handle
  // (friendly empty state), so assert the site nav is present.
  await expect(page.getByRole("link", { name: "Home", exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("nav does not overflow at 390px — sign-in button never clips (GH #18)", async ({
  page,
}) => {
  // iPhone 12/13/14-class width, the narrowest common phone viewport and the
  // one the bug report was filed against.
  await page.setViewportSize({ width: 390, height: 844 });

  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);

  const nav = page.locator(".siteNavBar").first();
  await expect(nav).toBeVisible();

  const viewportWidth = 390;
  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();
  if (navBox) {
    // The bar itself must stay within the viewport (no horizontal overflow).
    expect(navBox.x).toBeGreaterThanOrEqual(0);
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(viewportWidth + 1); // +1px rounding
  }

  // The sign-in control (present when Google auth is configured) must also
  // stay fully inside the viewport — this is the exact element the bug named.
  const signIn = page.locator(".authSignIn");
  if ((await signIn.count()) > 0) {
    const box = await signIn.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
    }
  }
});

// Mirrors lib/venues.ts venueGroupingKey + stableVenueIdFromKey exactly (a
// tiny, stable, public hash) so this test can deep-link straight to a known
// seed pub's detail sheet without depending on canvas pin clicks — headless
// Chromium has no WebGL/GPU, so the MapLibre canvas doesn't reliably paint
// clickable pins (see the WebGL-agnostic note at the top of this file).
function stableVenueIdFromKey(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// A known seed row from public/data/pint_prices_app_dataset.json ("Arnos
// Arms") — stable dataset, so this id doesn't drift.
const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

test("mobile venue sheet (GH #17): opens at the peek snap with the grab handle visible at 390px", async ({
  page,
}) => {
  // iPhone-class width — the same viewport the nav-overflow test above uses,
  // and the width the drag bottom-sheet gesture is scoped to (≤640px).
  await page.setViewportSize({ width: 390, height: 844 });

  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);

  // The right drawer is the mobile bottom sheet (components/PubMap.tsx +
  // venueSheet.css). A `sel=` deep link opens it immediately at the "half"
  // snap (PubMap.tsx's selectVenue default) — asserting `.open` rather than a
  // specific `.sheet-*` class keeps this robust to the exact snap default
  // while still proving the sheet-open contract that peek/half/full build on.
  const sheet = page.locator(".mapDrawer.right");
  await expect(sheet).toHaveClass(/open/);

  // The grab handle (the drag affordance itself) is visible and — even
  // without simulating a real pointer-drag — present in the DOM as the
  // documented gesture surface (components/map/VenueInspector.tsx).
  await expect(page.locator(".venueSheetGrab")).toBeVisible();

  // The sheet stays fully usable with no gesture at all: the close button and
  // tabs are reachable and functional (a11y contract from the spec).
  await expect(page.locator(".drawerClose")).toBeVisible();
  const tabs = page.getByRole("tab");
  await expect(tabs.first()).toBeVisible();
  await page.locator(".drawerClose").click();
  await expect(sheet).not.toHaveClass(/open/);
});

test("theme toggle flips html[data-theme], persists to localStorage, survives reload", async ({
  page,
}) => {
  // The floating ThemeToggle lives on /map. The no-flash inline script sets
  // data-theme before hydration, so an initial value always exists.
  await page.goto("/map");

  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  expect(before === "light" || before === "dark").toBe(true);

  // force: the floating toggle can sit under the route header in headless
  // layout; we're asserting the toggle's behaviour contract, not hit-testing.
  await page
    .getByRole("button", { name: /switch to (dark|light) theme/i })
    .click({ force: true });

  const after = await html.getAttribute("data-theme");
  expect(after).not.toBe(before);
  expect(after === "light" || after === "dark").toBe(true);

  // Persisted under the app's storage key, and the choice survives a reload.
  const stored = await page.evaluate(() => localStorage.getItem("pubmax-theme"));
  expect(stored).toBe(after);

  await page.reload();
  const storedAfterReload = await page.evaluate(() =>
    localStorage.getItem("pubmax-theme"),
  );
  expect(storedAfterReload).toBe(after);
  // The chosen theme is re-applied to <html data-theme> after reload — the
  // ThemeToggle mount effect re-asserts it (React 19 hydration can drop the
  // attribute the no-flash script set). Guards that fix.
  await expect(html).toHaveAttribute("data-theme", after);
});
