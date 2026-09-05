import { expect, test, type Page } from "@playwright/test";

import { LANDING_PRIMARY_NAME } from "./helpers/landingHero";

const DEVICES = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const THEMES = ["light", "dark"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("pubmax-theme", value);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
      version: 1,
      activatedAt: new Date().toISOString(),
    }));
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  }, theme);
}

for (const viewport of DEVICES) {
  for (const theme of THEMES) {
    test(`${viewport.width}px ${theme}: landing and Pub Pal controls stay uniform and clear`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await setTheme(page, theme);
      await page.goto("/");

      const heroActions = page.locator(".lpHero .screenActions a");
      await expect(heroActions).toHaveCount(2);
      await expect(page.getByRole("link", { name: LANDING_PRIMARY_NAME }).first()).toBeVisible();

      const actionGeometry = await heroActions.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      );
      expect(actionGeometry.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);

      const wordmark = page.getByRole("banner").locator(".lpWordmark .pubmaxxWordmark");
      await expect(wordmark).toBeVisible();
      await expect(wordmark.locator(".pubmaxxWordmarkAccent")).toHaveCount(1);

      await page.goto("/pal");
      // The meeting screen is painted on the SERVER, so its one primary action
      // is tappable in the document before React attaches, and a tap that lands
      // first is dropped with nothing on screen saying so. A lone click is
      // therefore not a wait for hydration: retry the tap itself until the
      // first onboarding step opens (same idiom as e2e/plan-invite.spec.ts).
      const meetPal = page.getByRole("button", { name: /Meet your Pub Pal/i });
      const eligibility = page.getByRole("heading", { name: "The grown-up bit first." });
      await expect(async () => {
        await meetPal.click();
        await expect(eligibility).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });

      const palGeometry = await page.evaluate(() => {
        const actions = document.querySelector(".palOnboardingActions")?.getBoundingClientRect();
        const pal = document.querySelector(".palExperience");
        const styles = pal ? getComputedStyle(pal) : null;
        const root = getComputedStyle(document.documentElement);
        return {
          actionsRight: actions?.right ?? Number.POSITIVE_INFINITY,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          accent: styles?.getPropertyValue("--pal-accent").trim(),
          brandAccent: root.getPropertyValue("--brass").trim(),
        };
      });

      await expect(page.locator(".mobileTabBar")).toBeHidden();
      expect(palGeometry.actionsRight).toBeLessThanOrEqual(viewport.width);
      expect(palGeometry.overflow).toBeLessThanOrEqual(1);
      expect(palGeometry.accent).toBe(palGeometry.brandAccent);

      const continueButton = page.getByRole("button", { name: /Continue/i });
      const continueBox = await continueButton.boundingBox();
      expect(continueBox?.height).toBeGreaterThanOrEqual(44);
      expect(continueBox?.width).toBeGreaterThanOrEqual(44);
    });
  }
}

// The compose action floats over the right edge of every scrolling phone
// surface, and the surfaces below print a price or a way-onward arrow in that
// cell. Each takes the control's own published lane (createFab.css); this is
// the rendered proof that nothing in the lane is painted over.
const COMPOSE_LANE_SURFACES = [
  { route: "/", row: ".lpRailLink" },
  { route: "/tonight", row: ".tonightSoftPlansLink" },
  { route: "/today", row: ".todayCardFootRow" },
] as const;

for (const surface of COMPOSE_LANE_SURFACES) {
  test(`390px: ${surface.route} keeps its right cell clear of the compose action`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setTheme(page, "light");
    await page.goto(surface.route);

    const fab = page.locator(".createFab");
    await expect(fab).toBeVisible();
    const fabBox = await fab.boundingBox();
    expect(fabBox).not.toBeNull();

    const rows = page.locator(surface.row);
    await expect(rows.first()).toBeVisible();
    // The last painted child of each row is what the control lands on: the
    // price badge, the arrow, the provenance line.
    const rightEdges = await rows.evaluateAll((elements) =>
      elements.flatMap((element) => {
        const children = Array.from(element.children).filter((child) => {
          const box = child.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        });
        return children.map((child) => {
          const box = child.getBoundingClientRect();
          return { right: box.right, top: box.top, bottom: box.bottom };
        });
      }),
    );
    expect(rightEdges.length).toBeGreaterThan(0);
    for (const cell of rightEdges) {
      const overlapsVertically =
        cell.bottom > fabBox!.y && cell.top < fabBox!.y + fabBox!.height;
      if (!overlapsVertically) continue;
      expect(cell.right).toBeLessThanOrEqual(fabBox!.x);
    }
  });
}

// Two rules the button system states and nothing measured: a control a thumb
// uses is at least 44px tall, and the icon inside a circular control sits at
// its centre. Both are read off the rendered page rather than off a stylesheet,
// because padding, line-height and an icon's own box all decide them.
const BUTTON_SYSTEM_ROUTES = ["/", "/tonight", "/today", "/near?patch=soho", "/places", "/plan", "/social"] as const;

for (const route of BUTTON_SYSTEM_ROUTES) {
  test(`390px: ${route} buttons keep the thumb floor and centre their icons`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setTheme(page, "light");
    await page.goto(route);
    await expect(page.locator("main, .appShell").first()).toBeVisible();

    const findings = await page.evaluate(() => {
      const describe = (element: Element) => {
        const classes =
          typeof element.className === "string" && element.className
            ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
            : "";
        return `${element.tagName.toLowerCase()}${classes}`;
      };
      const painted = (element: Element) => {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        const styles = getComputedStyle(element);
        return (
          styles.visibility !== "hidden" &&
          styles.display !== "none" &&
          Number(styles.opacity) > 0.05 &&
          styles.pointerEvents !== "none"
        );
      };
      const short: string[] = [];
      const offCentre: string[] = [];
      const controls = Array.from(
        document.querySelectorAll('button, [role="button"]'),
      );
      for (const control of controls) {
        if (!painted(control)) continue;
        if ((control as HTMLButtonElement).disabled) continue;
        const box = control.getBoundingClientRect();
        const styles = getComputedStyle(control);
        // A control painted as a control: it carries a fill or an edge. A bare
        // text button inside a sentence keeps the inline exception.
        const paintedAsControl =
          styles.backgroundColor !== "rgba(0, 0, 0, 0)" ||
          parseFloat(styles.borderTopWidth) > 0;
        if (paintedAsControl && box.height < 44) {
          short.push(`${describe(control)} ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
        const radius = parseFloat(styles.borderTopLeftRadius) || 0;
        const circular =
          Math.abs(box.width - box.height) <= 2 &&
          (styles.borderTopLeftRadius.includes("%")
            ? radius >= 40
            : radius >= box.width * 0.4);
        if (!circular) continue;
        const children = Array.from(control.children).filter(painted);
        if (children.length !== 1) continue;
        const inner = children[0].getBoundingClientRect();
        const dx = inner.left + inner.width / 2 - (box.left + box.width / 2);
        const dy = inner.top + inner.height / 2 - (box.top + box.height / 2);
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          offCentre.push(`${describe(control)} dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
        }
      }
      return { short, offCentre };
    });

    expect(findings.short).toEqual([]);
    expect(findings.offCentre).toEqual([]);
  });
}
