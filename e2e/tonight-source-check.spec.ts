import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`Tonight distinguishes an event date from its source check at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    const now = new Date().toISOString();
    const event = {
      id: "unmatched-dated-event",
      placeName: "A concert hall",
      title: "A dated concert",
      kind: "music",
      startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      observedAt: now,
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/fixture" },
      confidence: "listed",
    };
    await page.route("**/api/whats-on?**", (route) => route.fulfill({ json: {
      rows: [], readStatus: "ready", servedAt: now,
      sourceFreshnessKind: "unknown", kindObservedAt: {}, localityBasis: "london-default",
    } }));
    await page.route("**/api/out?**", (route) => route.fulfill({ json: {
      status: "ready", listingsStatus: "ready", venueMatch: "ready",
      events: [event], openPlans: [], attribution: [], providers: [],
      observedAt: { ticketmaster: now }, unmatchedCount: 1,
    } }));
    await page.goto("/tonight");
    await expect(page.getByText("Some event listings are not matched to a pub.", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`source-check-${width}.png`), fullPage: true });
    const credit = page.locator('[data-tonight-provenance="out"]');
    await expect(credit).toContainText("No pub-matched events");
    await expect(credit).toContainText("Ticketmaster");
    await expect(credit).toContainText("Checked");
    await expect(page.getByText("A dated concert", { exact: true })).toHaveCount(0);
    await expect(page.getByText("We can’t date these listings yet.", { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-tonight-provenance="undated-whats-on"]'))
      .toContainText("The pub listings source check date is not recorded.");
    await page.screenshot({ path: testInfo.outputPath(`source-check-${width}.png`), fullPage: true });
  });

  test(`Tonight keeps an invalid row's source check unknown at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    const now = new Date().toISOString();
    const event = {
      placeName: "A concert hall", title: "A dated concert", kind: "music",
      startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/fixture" },
      confidence: "listed",
    };
    await page.route("**/api/whats-on?**", (route) => route.fulfill({ json: {
      rows: [], readStatus: "ready", servedAt: now,
      sourceFreshnessKind: "unknown", kindObservedAt: {}, localityBasis: "london-default",
    } }));
    await page.route("**/api/out?**", (route) => route.fulfill({ json: {
      status: "ready", listingsStatus: "ready", venueMatch: "ready",
      events: [{ ...event, id: "dated", observedAt: now }, { ...event, id: "unknown", observedAt: "not-a-date" }],
      openPlans: [], attribution: [], providers: [], observedAt: { ticketmaster: now },
    } }));
    await page.goto("/tonight");
    const credit = page.locator('[data-tonight-provenance="out"]');
    await expect(credit).toHaveText("No pub-matched events via Ticketmaster · The live listings source check date is not recorded.");
    await expect(page.locator('[data-tonight-provenance="undated-out"]'))
      .toContainText("The live listings source check date is not recorded.");
    await page.screenshot({ path: testInfo.outputPath(`shared-source-${width}.png`), fullPage: true });
  });
}

for (const width of [1280, 390]) {
  for (const matched of [false, true]) {
    for (const complete of [false, true]) {
      test(`Tonight ${matched ? "music" : "empty pub result"} ${complete ? "dates known publishers" : "keeps an unnamed publisher uncertain"} at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        const now = new Date().toISOString();
        const event = {
          placeName: "The Fixture Arms", kind: "music", confidence: "listed",
          startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          ...(matched ? { venueId: "venue-1vle947" } : {}),
        };
        const known = { ...event, id: "known-publisher", title: "Known publisher gig", observedAt: now,
          source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/fixture" } };
        await page.route("**/api/whats-on?**", (route) => route.fulfill({ json: {
          rows: matched ? [{ ...known, id: "spine-deal", title: "Spine deal", kind: "deal", venueId: "venue-fixture-spine" }] : [],
          readStatus: "ready", servedAt: now, sourceFreshnessKind: "provider-observed",
          kindObservedAt: matched ? { deal: now } : {}, localityBasis: "london-default",
        } }));
        await page.route("**/api/out?**", (route) => route.fulfill({ json: {
          status: "ready", listingsStatus: "ready", venueMatch: "ready",
          events: [
            known,
            { ...event, id: "second-publisher", title: "Second publisher gig",
              ...(matched ? { venueId: "venue-4xlgb0", placeName: "The Second Fixture Arms" } : {}),
              ...(complete || matched ? { observedAt: now } : {}),
              source: { label: complete ? "Skiddle" : "", url: "https://example.com/event" } },
          ],
          openPlans: [], attribution: [], providers: [], observedAt: { ticketmaster: now, ...(complete ? { skiddle: now } : {}) },
        } }));
        await page.goto("/tonight");
        const credit = page.locator('[data-tonight-provenance="out"]');
        await expect(credit).toContainText("Ticketmaster");
        await expect(credit).toContainText(complete ? "Skiddle" : "an unrecorded source");
        if (matched) {
          await expect(page.getByRole("heading", { name: "Live music tonight", exact: true })).toBeVisible();
          await expect(page.getByText("Known publisher gig", { exact: true })).toBeVisible();
          const music = page.locator('[aria-labelledby="music-tonight-title"]');
          if (complete) await expect(music).toContainText("Checked");
          else await expect(music).not.toContainText("Checked");
        } else {
          await expect(credit).toContainText("No pub-matched events");
          await expect(page.getByText("Known publisher gig", { exact: true })).toHaveCount(0);
        }
        if (complete) {
          await expect(credit).toContainText("Checked");
          await expect(page.locator('[data-tonight-provenance="undated-out"]')).toHaveCount(0);
        } else {
          await expect(credit).not.toContainText("Checked");
          await expect(page.locator('[data-tonight-provenance="undated-out"]'))
            .toContainText("The live listings source check date is not recorded.");
        }
        await page.screenshot({ path: info.outputPath("publisher-boundary.png"), fullPage: true });
      });
    }
  }
}
