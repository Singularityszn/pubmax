import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";

// The Pal postcard (components/pal/PalPostcard.tsx): on a finished night's
// private recap, the reader's own Pal stands at the last stop of the route.
// The night is made, arrived at and finished the way mobile-plan-recap.spec.ts
// does it, and the plan's own capability opens the member recap. Shots land in
// artifacts/pal-postcard/ (gitignored).

const SHOTS = "artifacts/pal-postcard";

test("a finished night's recap shows the Pal at the last stop, with no drink count", async ({ page, request }) => {
  test.setTimeout(120_000);
  const startTime = new Date().toISOString();
  const venueResponse = await request.get("/data/venues_slim.json");
  const venues = ((await venueResponse.json() as { rows: Array<{ id: string; name: string }> }).rows).slice(0, 3);
  expect(venues).toHaveLength(3);
  const createdResponse = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Postcard night",
      creatorName: "Postcard host",
      startTime,
      stops: venues.map((venue) => ({ venueId: venue.id, venueName: venue.name })),
    },
  });
  expect(createdResponse.ok()).toBe(true);
  const created = await createdResponse.json() as { plan: { plan: { id: string } }; memberToken: string };
  const planId = created.plan.plan.id;
  const arrival = await request.post(`/api/plans/${planId}/actions`, {
    headers: { "idempotency-key": randomUUID() },
    data: { memberToken: created.memberToken, type: "arrived", stopPosition: 2 },
  });
  expect(arrival.ok()).toBe(true);
  const completion = await request.post(`/api/plans/${planId}/complete`, {
    data: {
      memberToken: created.memberToken,
      expectedRouteRevision: 1,
      ending: "get_home",
      endingSelection: {
        kind: "get_home",
        optionId: "transport:nearest-station",
        evidenceSnapshot: { label: "Nearest station", confidence: "unknown" },
      },
    },
  });
  expect(completion.ok()).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ id, token, appearance, personality, voice }) => {
    const now = "2026-10-04T12:00:00.000Z";
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem(`pubmax-plan-member:${id}`, token);
    window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: "owner-e2e", name: "Ripley",
      adultAttestedAt: now, appearance, personality, voice, muted: false, hidden: false,
      proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    }));
  }, { id: planId, token: created.memberToken, ...DEFAULT_PAL_DRAFT });

  // The plan page exchanges the member token for the plan's own session.
  await page.goto(`/plan/${planId}`);
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
  await page.goto(`/plan/${planId}/recap`);

  const postcard = page.getByTestId("pal-postcard");
  await expect(postcard).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "A postcard from Ripley" })).toBeVisible();
  await expect(postcard.locator(".palPostcardDot")).toHaveCount(3);
  await expect(postcard.locator(".palPostcardLine")).toHaveText("Ripley walked all 3 stops with you.");
  await expect(postcard.locator(".palPostcardTitle")).toHaveText("Postcard night");
  await expect(postcard).not.toContainText("£");
  const face = postcard.locator(".palPostcardPal img");
  await expect.poll(() => face.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await postcard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await mkdir(SHOTS, { recursive: true });
  await postcard.screenshot({ path: `${SHOTS}/pal-postcard-390.png` });

  // The saved image is the same card, drawn on this device.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save postcard" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("pal-postcard.png");
  await file.saveAs(`${SHOTS}/pal-postcard-saved.png`);
  await expect(page.getByRole("status").filter({ hasText: "Postcard ready." })).toBeVisible();
});
