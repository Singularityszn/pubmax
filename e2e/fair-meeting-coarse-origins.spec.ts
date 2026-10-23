import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// THE MEETING COMPARISON STAYS INSIDE ITS CARD AT EVERY WIDTH, IN BOTH THEMES.
//
// At 768 the Plan page keeps its two columns, so the collaboration card is
// narrow, and the preferences panel ran 20px past it with the area picker and
// the needs form. A viewport-only overflow check did not see that, because the
// page itself did not scroll. This spec measures the card and the rows inside
// it. The Plan comes from the public API in the browser's own context, so the
// page restores the host's membership from the normal session cookie.

const WIDTHS = [320, 390, 768, 1440] as const;
const THEMES = ["light", "dark"] as const;
const ROW = /: (longest [1-9]\d* min, average [1-9]\d* min|journey time unknown)$/;

test.setTimeout(120_000);

async function prepare(page: Page, theme: (typeof THEMES)[number], width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((initialTheme) => {
    window.localStorage.setItem("pubmax-theme", initialTheme);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
  }, theme);
}

async function openHostPlan(page: Page): Promise<void> {
  const slim = await (await page.request.get("/data/venues_slim.json")).json() as {
    rows: Array<{ id: string; name: string }>;
  };
  const venues = slim.rows.slice(0, 3);
  expect(venues).toHaveLength(3);
  const created = await page.request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Meeting point layout",
      startTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      creatorName: "Host",
      stops: venues.map((venue) => ({ venueId: venue.id, venueName: venue.name })),
    },
  });
  expect(created.ok()).toBe(true);
  const id = ((await created.json()) as { plan: { plan: { id: string } } }).plan.plan.id;
  const response = await page.goto(`/plan/${id}`);
  expect(response?.status()).toBe(200);
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`${width}px ${theme}: the meeting comparison and its controls stay inside the collaboration card`, async ({ page }) => {
      await prepare(page, theme, width);
      await openHostPlan(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const card = page.locator(".planCollab");
      await expect(card.getByRole("heading", { name: "Plan it together" })).toBeVisible({ timeout: 30_000 });
      const compare = card.getByRole("button", { name: "Compare journeys from broad areas" });
      await expect(compare).toHaveAttribute("aria-pressed", "false", { timeout: 30_000 });
      await expect(card.getByLabel("Broad starting area")).toHaveCount(0);

      // A tap before hydration is dropped, so the tap is retried until it holds.
      await expect(async () => {
        await compare.click();
        await expect(compare).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
      }).toPass({ timeout: 20_000 });

      const picker = card.getByLabel("Broad starting area");
      await picker.focus();
      await expect(picker).toBeFocused();
      for (const area of ["camden", "victoria"]) {
        await picker.selectOption(area);
        await card.getByRole("button", { name: "Add area" }).click();
      }
      await expect(card.getByRole("button", { name: "Remove Camden" })).toBeVisible();
      await expect(card.getByRole("button", { name: "Remove Victoria" })).toBeVisible();
      await expect(card).toContainText("Not a routed walk, and not step-free evidence.");
      const rows = card.getByRole("list", { name: "Journey comparison" }).getByRole("listitem");
      await expect(rows).toHaveCount(3, { timeout: 30_000 });
      for (const text of await rows.allTextContents()) {
        expect(text.replace(/\s+/g, " ").trim()).toMatch(ROW);
      }

      const fit = await card.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const left = box.left + element.clientLeft;
        const right = left + element.clientWidth;
        const escaped: Array<{ selector: string; left: number; right: number }> = [];
        for (const selector of [
          ".matchGroupPrefs",
          ".matchGroupPrefs__field",
          'select[aria-label="Broad starting area"]',
          '[aria-label="Journey comparison"]',
          ".planCollab__form",
          'select[aria-label="Need type"]',
          'select[aria-label="Need priority"]',
          ".matchGroupPrefs__chip",
        ]) {
          for (const child of element.querySelectorAll(selector)) {
            const rect = child.getBoundingClientRect();
            if (rect.width === 0) continue;
            if (rect.left < left - 0.5 || rect.right > right + 0.5) {
              escaped.push({ selector, left: rect.left, right: rect.right });
            }
          }
        }
        const prefs = element.querySelector(".matchGroupPrefs");
        return {
          escaped,
          cardOverflow: element.scrollWidth - element.clientWidth,
          prefsOverflow: prefs ? prefs.scrollWidth - prefs.clientWidth : null,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expect(fit.escaped).toEqual([]);
      expect(fit.cardOverflow).toBeLessThanOrEqual(1);
      expect(fit.prefsOverflow).not.toBeNull();
      expect(fit.prefsOverflow ?? Infinity).toBeLessThanOrEqual(1);
      expect(fit.pageOverflow).toBeLessThanOrEqual(1);
    });
  }
}
