import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { storyBandsForCity } from "@/lib/cityStoryBands";

const NAME = "W".repeat(32);
const STORY = storyBandsForCity("glasgow").find((band) => band.id === "subcrawl")!;
test.use({ storageState: { cookies: [], origins: [] } });

async function checkRow(page: Page, info: TestInfo, phase: string, consent: boolean) {
  await expect.poll(() => page.evaluate(() => {
    const pal = document.querySelector(".palSummon");
    const measured = Number.parseFloat(getComputedStyle(document.body).getPropertyValue("--pal-summon-rendered-h"));
    return pal ? Math.abs(measured - pal.getBoundingClientRect().height) < 0.1 : false;
  })).toBe(true);
  const sample = await page.evaluate(() => {
    const selectors = {
      pal: ".palSummon", avatar: ".palSummon .palAvatar", story: ".bandOnboardingChip",
      near: ".mobileMapLocateFab", create: ".createFab", consent: ".analyticsConsentPrompt",
      tabs: ".mobileTabBar",
    };
    const nodes = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
      const el = document.querySelector(selector);
      if (!el) return [key, null];
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return [key, {
        x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
        visible: style.display !== "none" && style.visibility !== "hidden",
        ownsCenter: !!hit && el.contains(hit),
      }];
    }));
    const nameElement = document.querySelector(".palSummon strong")!;
    const range = document.createRange();
    range.selectNodeContents(nameElement);
    const fragments = Array.from(range.getClientRects(), (r) => ({ x: r.x, y: r.y, right: r.right, bottom: r.bottom }));
    return {
      fragments,
      nameStyle: {
        overflow: getComputedStyle(nameElement).overflow,
        clamp: getComputedStyle(nameElement).webkitLineClamp,
        ellipsis: getComputedStyle(nameElement).textOverflow,
      },
      nodes, width: innerWidth, scrollY,
      height: Number.parseFloat(getComputedStyle(document.body).getPropertyValue("--pal-summon-rendered-h")),
      name: document.querySelector(".palSummon strong")?.textContent,
    };
  });
  await info.attach(`${phase}-geometry`, { body: JSON.stringify(sample, null, 2), contentType: "application/json" });
  await info.attach(`${phase}-viewport`, { body: await page.screenshot({ animations: "allow" }), contentType: "image/png" });
  const { pal, avatar, story, near, create, consent: prompt, tabs } = sample.nodes;
  expect(pal).not.toBeNull(); expect(avatar).not.toBeNull(); expect(story).not.toBeNull();
  expect(near).not.toBeNull(); expect(tabs).not.toBeNull();
  expect(sample.name).toBe(NAME);
  expect(sample.fragments.length).toBeGreaterThan(0);
  expect(sample.nameStyle.ellipsis).not.toBe("ellipsis");
  expect(["none", ""]).toContain(sample.nameStyle.clamp);
  expect(sample.nameStyle.overflow).toBe("visible");
  for (const fragment of sample.fragments) {
    expect(fragment.x).toBeGreaterThanOrEqual(pal!.x);
    expect(fragment.right).toBeLessThanOrEqual(pal!.right);
    expect(fragment.y).toBeGreaterThanOrEqual(pal!.y);
    expect(fragment.bottom).toBeLessThanOrEqual(pal!.bottom);
  }
  expect(sample.height).toBeCloseTo(pal!.height, 1);
  expect(avatar!.width).toBe(36);
  if (sample.width === 320) expect(pal!.width).toBe(232);
  expect(pal!.x).toBeGreaterThanOrEqual(12);
  expect(pal!.right).toBeLessThanOrEqual(near!.x - 12);
  expect(pal!.bottom).toBeCloseTo(near!.bottom, 1);
  expect(story!.bottom).toBeLessThanOrEqual(Math.min(pal!.y, near!.y) - 12);
  for (const node of [pal!, near!]) {
    expect(node.width).toBeGreaterThanOrEqual(44);
    expect(node.height).toBeGreaterThanOrEqual(44);
    expect(node.ownsCenter).toBe(true);
    expect(node.y).toBeGreaterThanOrEqual(0);
    expect(node.bottom).toBeLessThanOrEqual(tabs!.y);
  }
  if (consent) {
    expect(prompt?.visible).toBe(true);
    expect(pal!.bottom).toBeLessThanOrEqual(prompt!.y);
    expect(near!.bottom).toBeLessThanOrEqual(prompt!.y);
    expect(create?.visible ?? false).toBe(false);
  } else {
    expect(create?.visible).toBe(true);
    expect(create!.ownsCenter).toBe(true);
    expect(create!.bottom).toBeLessThanOrEqual(Math.min(pal!.y, near!.y) - 12);
    expect(story!.bottom).toBeLessThanOrEqual(create!.y - 12);
  }
  return pal!.height;
}

for (const consent of [false, true]) {
  test(`long Pal height reserves the story row, consent=${consent}`, async ({ page }, info) => {
    // The deferred shell mounts after 30 seconds. Keep its real lifecycle.
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(({ consent, name }) => {
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      if (!consent) localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      const now = "2026-01-01T00:00:00.000Z";
      localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
        id: "pal-e2e", ownerId: "owner-e2e", name, adultAttestedAt: now,
        appearance: {}, personality: {}, voice: {}, muted: false, hidden: false,
        proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
      }));
    }, { consent, name: NAME });
    await page.goto("/about");
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("pubmax:consent-first-route:v1"))).toBe("/about");
    await page.goto("/map/glasgow?band=subcrawl");
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: `Summon ${NAME}, your Pub Pal`, exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".bandOnboardingChip span")).toHaveText(STORY.copy);
    await expect(page.locator(".createFabRoot")).toBeAttached();
    if (consent) await expect(page.getByLabel("Anonymous analytics choice")).toBeVisible();
    else await expect(page.locator(".createFab")).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const narrowHeight = await checkRow(page, info, "320-row", consent);
    await page.setViewportSize({ width: 430, height: 932 });
    await checkRow(page, info, "430-row", consent);
    await page.setViewportSize({ width: 640, height: 932 });
    const wideHeight = await checkRow(page, info, "640-row", consent);
    expect(wideHeight).toBeLessThan(narrowHeight);
    await page.setViewportSize({ width: 320, height: 568 });
    expect(await checkRow(page, info, "320-return", consent)).toBeCloseTo(narrowHeight, 1);
    if (consent) {
      await page.getByRole("button", { name: "No thanks", exact: true }).click();
      await expect(page.getByLabel("Anonymous analytics choice")).toBeHidden();
      await expect(page.locator(".createFab")).toBeVisible();
      await checkRow(page, info, "after-no-thanks", false);
    }
  });
}
