import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { resolveAuditOutputRoot } from "../scripts/lib/uiUxBattleTestOutput.mjs";

type AuditedRoute = {
  path: string;
  ready: string;
  settles?: "profile" | "tonight";
};

const AUDITED_ROUTES: AuditedRoute[] = [
  { path: "/", ready: "main#main" },
  { path: "/today", ready: '[data-testid="today-screen"]' },
  {
    path: "/tonight",
    ready: '[data-testid="tonight-screen"]',
    settles: "tonight",
  },
  { path: "/near", ready: ".nmnIntro" },
  { path: "/add/karan", ready: "main.addShell" },
  {
    path: "/login",
    ready:
      ".loginPageForm, .loginPageSignedIn, .loginPageWelcomeBack, .loginPageNotice:not(:has-text('Checking your session'))",
  },
  { path: "/u/karan", ready: "main.profileMain", settles: "profile" },
  { path: "/map/london", ready: ".mapCanvasWrap" },
  { path: "/plan", ready: "main.planPage h1" },
  { path: "/crawls", ready: "main.crawlsShell:not([aria-busy='true'])" },
];

async function waitForAuditedRoute(page: Page, route: AuditedRoute) {
  await expect(page.locator(route.ready).first(), `${route.path} ready marker`).toBeVisible({
    timeout: 30_000,
  });
  if (route.settles === "tonight") {
    await expect(page.getByText("Reading tonight’s listings…")).toHaveCount(0, {
      timeout: 30_000,
    });
  }
  if (route.settles === "profile") {
    await expect(page.locator(".profileTimelineSkel, .profileHeaderLoading")).toHaveCount(0, {
      timeout: 30_000,
    });
  }
  if (route.path !== "/login" && route.path !== "/map/london") {
    await expect(page.locator(".authUser").first()).toBeAttached({ timeout: 30_000 });
  }
}

test("audit output stays inside dedicated temporary root", () => {
  expect(resolveAuditOutputRoot("after-dark")).toBe(
    "/tmp/pubmax-ui-ux-battle-test/after-dark",
  );
  for (const unsafe of [".", "..", "../proof", "/tmp/proof"]) {
    expect(() => resolveAuditOutputRoot(unsafe)).toThrow(
      "UI_UX_OUTPUT must be one safe directory name",
    );
  }
});

test("audited labels keep readable contrast in reachable states", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForAuditedRoute(page, AUDITED_ROUTES[0]);
  const landing = await new AxeBuilder({ page })
    .include(".lpProofSection .lpSectionLabel")
    .withRules(["color-contrast"])
    .analyze();
  expect(landing.violations).toEqual([]);

  await page.goto("/crawls?pack=old-london", { waitUntil: "domcontentloaded" });
  await waitForAuditedRoute(page, AUDITED_ROUTES[AUDITED_ROUTES.length - 1]);
  const crawls = await new AxeBuilder({ page })
    .include(".routePackChip.isActive")
    .include(".routePackActiveNote a")
    .withRules(["color-contrast"])
    .analyze();
  expect(crawls.violations).toEqual([]);
});

test.describe("UI UX battle-test guardrails", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("audited mobile routes keep tap targets and page width within contract", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-theme", "light");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    for (const route of AUDITED_ROUTES) {
      await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForAuditedRoute(page, route);

      const result = await page.evaluate(() => {
        const visible = (element: Element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.pointerEvents !== "none" &&
            Number.parseFloat(style.opacity || "1") > 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const undersized = [...document.querySelectorAll(
          'button, a, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])',
        )]
          .filter(visible)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              element: element.tagName.toLowerCase(),
              label: (element.getAttribute("aria-label") || element.textContent || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80),
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10,
            };
          })
          .filter(({ width, height }) => width < 44 || height < 44);

        return {
          undersized,
          overflow: Math.max(
            document.documentElement.scrollWidth,
            document.body?.scrollWidth ?? 0,
          ) - document.documentElement.clientWidth,
        };
      });

      expect(result.undersized, `${route.path} has undersized interactive controls`).toEqual([]);
      expect(result.overflow, `${route.path} has horizontal overflow`).toBeLessThanOrEqual(1);
    }
  });
});
