import { expect, test } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { installVitalsProbe, readVitals } from "./helpers/webVitals";

const CASES = [
  { label: "desktop empty feed", width: 1280, height: 720, populated: false },
  { label: "phone empty feed", width: 390, height: 844, populated: false },
  { label: "desktop populated feed and activity", width: 1280, height: 720, populated: true },
  { label: "phone populated feed and activity", width: 390, height: 844, populated: true },
  { label: "desktop from map", width: 1280, height: 720, populated: false, fromMap: true },
] as const;

for (const day of ["2026-10-30", "2026-11-17"]) for (const sample of CASES) {
  test(`Social stays steady while access resolves: ${sample.label} on ${day}`, async ({ page }, info) => {
    // Activate the campaign only after the public fixture is present.
    await page.clock.setFixedTime(new Date(`${day === "2026-11-17" ? "2026-11-16" : day}T14:00:00Z`));
    await page.setViewportSize({ width: sample.width, height: sample.height });
    const auth = await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    await auth.signedInAs("A");
    await installVitalsProbe(page);
    await page.addInitScript(() => {
      const samples: unknown[] = [];
      (window as typeof window & { socialShiftSamples: unknown[] }).socialShiftSamples = samples;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean; sources: Array<{ node?: Element; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) {
          if (entry.hadRecentInput) continue;
          samples.push({ value: entry.value, sources: entry.sources.map((source) => ({
            node: source.node?.className,
            previous: source.previousRect.toJSON(),
            current: source.currentRect.toJSON(),
          })) });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });

    await page.route("**/api/pint-drops?city=london", (route) => route.fulfill({ json: { drops: [] } }));
    const protectedReads: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/^\/api\/social\/(posts|outbox|tags|crews|rankings|reviews)$/.test(path)) protectedReads.push(path);
    });
    const post = {
      id: "layout-proof", kind: "standard", visibility: "public", body: "A quiet evening with friends.",
      area: "camden", venueId: null, venueName: null, hashtags: [], commentPolicy: "open",
      photo: null, moderationState: "approved", featureRequest: null, revision: 0, editedAt: null,
      createdAt: "2026-11-01T19:00:00.000Z", updatedAt: "2026-11-01T19:00:00.000Z",
      ownedByViewer: false, author: { handle: "layout_proof" },
    };
    const activity = { id: "layout-cheer", kind: "cheer", readAt: null, createdAt: "2026-11-01T19:00:00.000Z" };
    let releaseAccess!: () => void;
    const accessReady = new Promise<void>((resolve) => { releaseAccess = resolve; });
    await page.route("**/api/social/access", async (route) => {
      await accessReady;
      await route.fulfill({ json: {
        state: "verified", viewerHandle: "karan", draftScope: "a".repeat(43),
      } });
    });
    await page.route("**/api/social/posts**", (route) => route.fulfill({ json: { posts: sample.populated ? [post] : [], nextCursor: null } }));
    await page.route("**/api/social/interactions**", (route) => route.fulfill({ json:
      new URL(route.request().url()).searchParams.get("view") === "summary"
        ? { summary: { cheered: false, saved: false, cheerCount: 0 } }
        : { items: sample.populated ? [activity] : [], nextCursor: null },
    }));
    await page.route("**/api/social/outbox", (route) => route.fulfill({ json: { posts: [] } }));
    await page.route("**/api/social/tags**", (route) => route.fulfill({ json: { proposals: [], nextCursor: null } }));
    await page.route("**/api/social/crews", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
    await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: { people: [], nextCursor: null } }));
    await page.route("**/api/social/rankings", (route) => route.fulfill({ json: { entries: [] } }));
    await page.route("**/api/social/reviews**", (route) => route.fulfill({ json: { entries: [] } }));

    const feedRead = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/social/posts");
    try {
      if ("fromMap" in sample) {
        await installDeterministicMapBasemap(page);
        await page.goto("/map");
        await page.getByRole("navigation", { name: "Site navigation", exact: true }).getByRole("link", { name: "Social", exact: true }).click();
        await page.waitForURL("**/social");
      } else {
        await page.goto("/social");
      }
      await expect(page.getByRole("status").filter({ hasText: "Checking Social access…" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: info.outputPath("social-access-pending.png") });
      expect(protectedReads, "Neutral sample cards must not read protected data").toEqual([]);
      await expect(page.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Rank a pub", exact: true })).toHaveCount(0);
    } finally {
      releaseAccess();
    }
    await feedRead;
    if (sample.populated) {
      await expect(page.getByRole("heading", { name: "Your lot, lately" })).toBeVisible();
      await expect(page.getByText(post.body, { exact: true })).toBeVisible();
      if (sample.width >= 900) {
        await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
      } else {
        await expect(page.locator(".socialContextRail")).toBeHidden();
      }
    } else {
      await expect(page.locator(".socialFeed")).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Post lanes" })).toBeVisible();
    }
    await expect(page.getByText("No crews yet. Start one and your lot can join the night.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Rank a pub", exact: true })).toBeVisible();
    const publicContent = page.locator(sample.populated ? ".socialPostList" : ".socialLondonEmpty");
    await expect(publicContent).toHaveCount(1);
    const readPublicPosition = () => publicContent.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { x: box.left + window.scrollX, y: box.top + window.scrollY, width: box.width, height: box.height };
    });
    const beforeCampaign = await readPublicPosition();
    expect(beforeCampaign.width).toBeGreaterThan(0);
    expect(beforeCampaign.height).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath("social-before-campaign.png") });
    if (day === "2026-11-17") {
      await page.clock.setFixedTime(new Date(`${day}T14:00:00Z`));
      await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
      await expect(page.getByText("No prices from today in these public results.", { exact: true })).toBeVisible();
    } else {
      await expect(page.locator(".socialLogInPublic")).toHaveCount(0);
    }
    await page.screenshot({ path: info.outputPath("social-feed-ready.png") });
    const vitals = await readVitals(page);
    const shifts = await page.evaluate(() => (window as typeof window & { socialShiftSamples: unknown[] }).socialShiftSamples);
    await info.attach("layout-shifts", { body: JSON.stringify(shifts), contentType: "application/json" });
    await info.attach("web-vitals", { body: JSON.stringify(vitals), contentType: "application/json" });
    const afterCampaign = await readPublicPosition();
    await info.attach("public-content-positions", {
      body: JSON.stringify({ beforeCampaign, afterCampaign }), contentType: "application/json",
    });
    expect(afterCampaign.height).toBeGreaterThan(0);
    // Optional campaign content must not displace a card that the reader could already read.
    expect(Math.abs(afterCampaign.y - beforeCampaign.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterCampaign.x - beforeCampaign.x)).toBeLessThanOrEqual(1);
    expect(vitals.cls, "Access and feed results must not move the page past the CLS target").toBeLessThanOrEqual(0.1);
  });
}
