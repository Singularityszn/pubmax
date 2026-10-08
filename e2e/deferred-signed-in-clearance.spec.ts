import { expect, test, type Page } from "@playwright/test";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

async function returningAccount(page: Page) {
  await installAuthDoubles(page);
  await page.addInitScript(() => {
    localStorage.removeItem("pubmaxx:analytics-consent:v1");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax:first-run-welcome:v1", "1");
    localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
      version: 1, activatedAt: new Date().toISOString(),
    }));
  });
  await seedSignedIn(page, "A");
  await expect.poll(
    () => page.evaluate(() =>
      sessionStorage.getItem("pubmax:consent-first-route:v1")),
    { timeout: 30_000 },
  ).toBe("/today");
}

for (const width of [390, 768, 1440]) {
for (const theme of ["light", "dark"] as const) {
  const height = width === 390 ? 844 : width === 768 ? 1024 : 900;
  for (const [nameCase, name] of [
    ["short", "Moss"],
    ["long", "The Wednesday Wetherspoons Pal"],
    ["unbroken", "W".repeat(32)],
  ] as const) {
  const suffix = nameCase === "short" ? "" : `, ${nameCase} name`;
  test(`signed-in Pal voice controls clear consent on arrival, ${width} ${theme}${suffix}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const timestamp = "2026-10-04T12:00:00.000Z";
    const pal = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
      name, adultAttestedAt: timestamp,
      appearance: DEFAULT_PAL_DRAFT.appearance, personality: DEFAULT_PAL_DRAFT.personality,
      voice: DEFAULT_PAL_DRAFT.voice, muted: false, hidden: false,
      proposalPreferences: { memories: false, routes: true }, masteryPoints: 0,
      createdAt: timestamp, updatedAt: timestamp,
    };
    await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal, adultOnFile: true } }));
    await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
    await page.route("**/api/pub-pal/voice-token", (route) => {
      expect(route.request().method()).toBe("GET");
      return route.fulfill({ json: { available: true, retention: "provider_default" } });
    });
    await returningAccount(page);
    await page.goto("/pal");
    const start = page.getByRole("button", { name: "Start voice chat", exact: true });
    await expect(start).toBeVisible();
    await expect(page.locator(".analyticsConsentPrompt")).toBeVisible();
    const heading = page.getByRole("heading", { name, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(name);
    const nameFits = await heading.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].every((rect) =>
        rect.left >= 0 && rect.right <= window.innerWidth);
    });
    expect(nameFits).toBe(true);
    const plan = page.getByRole("link", { name: `Plan with ${name}`, exact: true });
    await expect(plan).toBeVisible();
    await expect(plan).toContainText(name);
    const planTextFits = await plan.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].every((rect) =>
        rect.left >= box.left && rect.right <= box.right);
    });
    expect(planTextFits).toBe(true);
    if (width === 390) {
      const portrait = await page.locator(".palHomePortrait .palPortrait").boundingBox();
      expect(portrait?.width).toBe(160);
      expect(portrait?.height).toBe(160);
    }
    const geometry = await page.locator(".palVoice").evaluate((element) => {
      const card = element.getBoundingClientRect();
      const consent = document.querySelector(".analyticsConsentPrompt")!.getBoundingClientRect();
      const input = element.querySelector("input")!;
      const field = input.getBoundingClientRect();
      const button = element.querySelector(".palVoiceActions > button")!;
      const target = button.getBoundingClientRect();
      return {
        clearance: consent.top - card.bottom,
        targetHeight: target.height,
        targetHit: button.contains(document.elementFromPoint(target.x + target.width / 2, target.y + target.height / 2)),
        fieldHeight: field.height,
        fieldFontSize: parseFloat(getComputedStyle(input).fontSize),
        hit: element.contains(document.elementFromPoint(field.x + field.width / 2, field.y + field.height / 2)),
      };
    });
    expect(geometry.clearance).toBeGreaterThanOrEqual(12);
    expect(geometry.targetHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.targetHit).toBe(true);
    expect(geometry.fieldHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.fieldFontSize).toBeGreaterThanOrEqual(16);
    expect(geometry.hit).toBe(true);
    await start.focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(".palVoiceActions input")).toBeFocused();
    await page.keyboard.type("A quiet night");
    await expect(page.locator(".palVoiceActions input")).toHaveValue("A quiet night");
  });
  }

  test(`signed-in Plan map clears consent, ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const response = await page.request.post("/api/plans", {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        title: "Local Blackfriars route",
        startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        creatorName: "Local QA",
        stops: [
          { venueId: "venue-eltcmh", venueName: "The Blackfriar" },
          { venueId: "venue-ac8hv3", venueName: "The Albion" },
          { venueId: "venue-1kt3p9o", venueName: "The Old Bell Tavern" },
        ],
      },
    });
    expect(response.ok()).toBe(true);
    const id = (await response.json()).plan.plan.id;
    await returningAccount(page);
    await page.goto(`/plan/${id}`);
    const fullPlan = page.getByRole("button", { name: "View full plan", exact: true });
    if (width <= 640) {
      await expect(fullPlan).toBeVisible();
      await fullPlan.click();
    }
    await expect(page.locator(".planRouteMiniMap__canvas")).toBeVisible();
    await expect(page.locator(".analyticsConsentPrompt")).toBeVisible();
    const map = page.locator(".planRouteMiniMap--clickable");
    await map.scrollIntoViewIfNeeded();
    const geometry = await map.evaluate((element) => {
      const card = element.getBoundingClientRect();
      const consent = document.querySelector(".analyticsConsentPrompt")!.getBoundingClientRect();
      return {
        clearance: consent.top - card.bottom,
        height: card.height,
        hit: element.contains(document.elementFromPoint(card.x + card.width / 2, card.y + card.height / 2)),
      };
    });
    expect(geometry.clearance).toBeGreaterThanOrEqual(12);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.hit).toBe(true);
    await map.focus();
    await expect(map).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/map\?mode=build&pubs=/);
  });
}
}
