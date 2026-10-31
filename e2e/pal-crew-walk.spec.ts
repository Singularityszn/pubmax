import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";

// Pals walk together (components/map/pubmap/useCrewPals.ts): on a plan that is
// on tonight, the opted-in Pals of the other crew members walk the plan's own
// route beside the reader's Pal. The plan read and the crew read are answered
// here, so the test reads the map, not the stores. Shots land in
// artifacts/pal-crew-walk/ (gitignored).

const SHOTS = "artifacts/pal-crew-walk";
const PLAN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STOPS = ["venue-1ufn31x", "venue-1t8siin", "venue-xiesdn"];

test("the crew's opted-in Pals walk the plan's route beside the reader's own", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/plans/${PLAN_ID}`, (route) => route.fulfill({
    json: { stops: STOPS.map((venueId, position) => ({ venueId, venueName: venueId, position })) },
  }));
  let crewReads = 0;
  await page.route(`**/api/plans/${PLAN_ID}/pals`, (route) => {
    crewReads += 1;
    return route.fulfill({
      json: {
        visibility: "member",
        pals: [
          { id: "crew-pal-1", name: "Moss", species: "fox", personality: DEFAULT_PAL_DRAFT.personality, muted: false },
          { id: "crew-pal-2", name: "Fen", species: "robin", personality: DEFAULT_PAL_DRAFT.personality, muted: true },
        ],
      },
    });
  });
  await page.addInitScript(({ planId, appearance, personality, voice }) => {
    const now = "2026-10-04T12:00:00.000Z";
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: "owner-e2e", name: "Ripley",
      adultAttestedAt: now, appearance, personality, voice, muted: false, hidden: false,
      proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    }));
    window.localStorage.setItem("pubmax_active_plan", JSON.stringify({
      version: 1, id: planId, startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(), stopIndex: 0,
    }));
  }, { planId: PLAN_ID, ...DEFAULT_PAL_DRAFT });
  await page.goto("/map");

  const own = page.locator(".palMapMarker:not([data-pal-crew])");
  const crew = page.locator(".palMapMarker[data-pal-crew]");
  await expect(own).toHaveCount(1, { timeout: 60_000 });
  await expect(crew).toHaveCount(2, { timeout: 60_000 });
  expect(crewReads).toBeGreaterThan(0);
  // A crew Pal is a picture on the map, never a control, and names no owner.
  for (const marker of await crew.all()) {
    await expect(marker).toHaveAttribute("aria-hidden", "true");
    await expect(marker.locator("a, button")).toHaveCount(0);
  }
  // The avatar itself, not its talking frame (.palMapMarkerMouth) laid over it.
  await expect(page.locator(".palMapMarker[data-pal-crew='0'] img:not(.palMapMarkerMouth)")).toHaveAttribute("src", /fox/);

  // They walk the same route as the reader's Pal, and rest beside tonight's next stop.
  await expect(own).toHaveAttribute("data-pal-walk", /walking|rested/, { timeout: 30_000 });
  await mkdir(SHOTS, { recursive: true });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/crew-walking-390.png` });
  await expect(own).toHaveAttribute("data-pal-walk", "rested", { timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/crew-rested-390.png` });
});
