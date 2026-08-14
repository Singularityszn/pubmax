import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import {
  AUDITED_ORIGINS,
  AUDITED_ROUTES,
  navigateToAuditedRoute,
  selectAuditedOrigins,
  selectAuditedRoutes,
} from "../scripts/lib/uiUxBattleTestNavigation.mjs";
import { resolveAuditOutputRoot } from "../scripts/lib/uiUxBattleTestOutput.mjs";

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

test("audit filters reject empty and unknown selections", () => {
  expect(selectAuditedOrigins("local")).toEqual([AUDITED_ORIGINS[1]]);
  expect(selectAuditedRoutes("today,/crawls")).toEqual([
    AUDITED_ROUTES[1],
    AUDITED_ROUTES[AUDITED_ROUTES.length - 1],
  ]);
  expect(() => selectAuditedOrigins("")).toThrow("select at least one origin");
  expect(() => selectAuditedOrigins("staging")).toThrow("Unknown UI_UX_ORIGINS value: staging");
  expect(() => selectAuditedRoutes("/missing")).toThrow("Unknown UI_UX_ROUTES value: /missing");
});

test("shared audit navigation rejects HTTP failures and waits for settled UI", async ({
  baseURL,
  page,
}) => {
  await page.route("**/audit-http-failure", (route) =>
    route.fulfill({ status: 503, contentType: "text/html", body: "<main>Unavailable</main>" }),
  );
  await expect(
    navigateToAuditedRoute(page, baseURL!, {
      name: "failure",
      path: "/audit-http-failure",
      readySelector: "main",
    }),
  ).rejects.toThrow("HTTP 503");

  await page.unroute("**/audit-http-failure");
  await page.route("**/audit-delayed", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `
        <main class="pending">Loading</main>
        <script>
          setTimeout(() => {
            document.querySelector(".pending").remove();
            document.body.insertAdjacentHTML("beforeend", '<main class="ready">Ready</main>');
          }, 100);
        </script>
      `,
    }),
  );
  await navigateToAuditedRoute(page, baseURL!, {
    name: "delayed",
    path: "/audit-delayed",
    readySelector: ".ready",
    pendingSelectors: [".pending"],
  });
  await expect(page.locator(".ready")).toBeVisible();
  await expect(page.locator(".pending")).toHaveCount(0);
});

test("audited labels keep readable contrast in reachable states", async ({ baseURL, page }) => {
  test.setTimeout(120_000);
  for (const theme of ["light", "dark"]) {
    await page.goto("/");
    await page.evaluate((value) => localStorage.setItem("pubmax-theme", value), theme);

    await navigateToAuditedRoute(page, baseURL!, AUDITED_ROUTES[0]);
    const landing = await new AxeBuilder({ page })
      .include(".lpProofSection .lpSectionLabel")
      .withRules(["color-contrast"])
      .analyze();
    expect(landing.violations, `${theme} landing contrast`).toEqual([]);

    const tonightRoute = AUDITED_ROUTES.find((route) => route.name === "tonight")!;
    await navigateToAuditedRoute(page, baseURL!, tonightRoute);
    await page.locator(".tonightFootLink").hover();
    const tonight = await new AxeBuilder({ page })
      .include(".tonightFootLink")
      .withRules(["color-contrast"])
      .analyze();
    expect(tonight.violations, `${theme} Tonight contrast`).toEqual([]);

    const crawlsRoute = {
      ...AUDITED_ROUTES.find((route) => route.name === "crawls")!,
      path: "/crawls?pack=old-london",
    };
    await navigateToAuditedRoute(page, baseURL!, crawlsRoute);
    await page.locator(".routePackChip.isActive").hover();
    const crawls = await new AxeBuilder({ page })
      .include(".routePackChip.isActive")
      .include(".routePackActiveNote a")
      .include(".curatedPriceFrom")
      .withRules(["color-contrast"])
      .analyze();
    expect(crawls.violations, `${theme} Crawls contrast`).toEqual([]);
  }
});

test.describe("UI UX battle-test guardrails", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("audited mobile routes keep tap targets and page width within contract", async ({
    baseURL,
    page,
  }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-theme", "light");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    for (const route of AUDITED_ROUTES) {
      await navigateToAuditedRoute(page, baseURL!, route);

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
