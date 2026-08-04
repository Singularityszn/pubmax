#!/usr/bin/env node
/**
 * Firefox browser proof for contributor identity surfaces.
 *
 * Playwright Firefox only (chrome-devtools-axi writes no files).
 * Screenshots land in docs/proof/contributor-identity/.
 *
 * Surfaces:
 *   1) signed-out map with venue selected (price entry visible)
 *   2) signed-in incomplete onboarding dialog (handle + date of birth)
 *   3) signed-in complete account on the venue sheet
 *
 * Each surface is shot at 390x844 and 1440x900, light and dark.
 *
 * Usage: node scripts/contributor-identity-firefox-proof.mjs [baseUrl]
 * Default baseUrl: http://localhost:3128
 *
 * Server must be started with the E2E Supabase boundary env (see playwright.config.ts):
 *   NEXT_PUBLIC_SUPABASE_URL=https://pubmaxx-e2e.supabase.co
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=pubmaxx-e2e-publishable-key
 *   PUBMAX_E2E_KEYLESS=1
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { firefox } = await import("playwright-core");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "proof", "contributor-identity");
const BASE = process.argv[2] || "http://localhost:3128";

const SEED_VENUE_ID = "venue-16pnwmm";
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];
const THEMES = ["light", "dark"];

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot", name);
  return file;
}

async function applyTheme(page, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.evaluate((scheme) => {
    const root = document.documentElement;
    if (scheme === "dark") {
      root.dataset.theme = "dark";
      root.classList.add("dark");
    } else {
      root.dataset.theme = "light";
      root.classList.remove("dark");
    }
    try {
      window.localStorage.setItem("pubmax-theme", scheme);
    } catch {
      // ignore
    }
  }, theme);
}

async function dismissFirstRun(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function seedSignedIn(page) {
  await page.addInitScript(
    ({ authStorageKey, userId }) => {
      window.localStorage.setItem(
        authStorageKey,
        JSON.stringify({
          access_token: "pubmaxx-e2e-access-token",
          refresh_token: "pubmaxx-e2e-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 86_400,
          expires_in: 86_400,
          token_type: "bearer",
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "identity-proof@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-07-29T00:00:00.000Z",
          },
        }),
      );
    },
    { authStorageKey: E2E_AUTH_STORAGE_KEY, userId: E2E_AUTH_USER_ID },
  );
}

async function installIdentityRoutes(page, { requireOnboarding }) {
  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "identity-proof@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ complete: true, handle: "night_owl" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        requireOnboarding
          ? { complete: false }
          : { complete: true, handle: "night_owl" },
      ),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        handle: requireOnboarding ? null : "night_owl",
      }),
    });
  });
  await page.route("**/api/identity/handle/availability?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true }),
    });
  });
  await page.route("**/api/price-submit**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          status: "sign_in_required",
          error: "Sign in to contribute.",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ prices: [], signals: [] }),
    });
  });
}

async function openVenue(page) {
  const response = await page.goto(`${BASE}/map?sel=${SEED_VENUE_ID}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  if (!response || response.status() >= 500) {
    throw new Error(`map load failed: ${response?.status()}`);
  }
  // Give the sheet and identity overlay a moment to settle.
  await page.waitForTimeout(1_500);
}

async function captureMatrix(browser, scenario, setup) {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      const page = await context.newPage();
      await dismissFirstRun(page);
      await setup(page);
      await applyTheme(page, theme);
      await openVenue(page);
      await applyTheme(page, theme);
      // Wait for the defining surface of this scenario.
      if (scenario === "onboarding") {
        await page
          .getByRole("dialog", { name: /Choose how people know you/i })
          .waitFor({ state: "visible", timeout: 30_000 })
          .catch(() => {});
      } else if (scenario === "signed-out") {
        await page
          .locator(".venuePriceSubmit, [data-sheet-kind='venue']")
          .first()
          .waitFor({ state: "visible", timeout: 30_000 })
          .catch(() => {});
      } else {
        await page
          .locator(".venuePriceSubmit, [data-sheet-kind='venue']")
          .first()
          .waitFor({ state: "visible", timeout: 30_000 })
          .catch(() => {});
      }
      await shot(
        page,
        `${scenario}-${viewport.name}-${theme}.png`,
      );
      await context.close();
    }
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await firefox.launch({ headless: true });
  const report = {
    base: BASE,
    venueId: SEED_VENUE_ID,
    capturedAt: new Date().toISOString(),
    viewports: VIEWPORTS,
    themes: THEMES,
    scenarios: ["signed-out", "onboarding", "signed-in"],
  };

  try {
    await captureMatrix(browser, "signed-out", async (page) => {
      // Anonymous reader: no session seed.
    });

    await captureMatrix(browser, "onboarding", async (page) => {
      await seedSignedIn(page);
      await installIdentityRoutes(page, { requireOnboarding: true });
    });

    await captureMatrix(browser, "signed-in", async (page) => {
      await seedSignedIn(page);
      await installIdentityRoutes(page, { requireOnboarding: false });
    });

    await writeFile(
      path.join(OUT, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log("done", OUT);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
