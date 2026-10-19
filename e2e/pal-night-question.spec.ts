import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// The Pal's evening question on /pal (components/pal/PalNightQuestion.tsx):
// "Right. Quiet couple, or is it one of those nights?", and each answer opens a
// plan of that shape. Shots land in artifacts/pal-night-question/ (gitignored).

const SHOTS = "artifacts/pal-night-question";

test("the Pal asks what kind of night it is, and the answer opens that plan", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  // Half past seven on a Monday evening in London (British Summer Time).
  await page.clock.install({ time: new Date("2026-10-19T18:30:00Z") });
  await installAuthDoubles(page);
  const now = "2026-10-04T12:00:00.000Z";
  const serverPal = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
    adultAttestedAt: now, ...DEFAULT_PAL_DRAFT, name: "Ripley", muted: false, hidden: false,
    proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
  };
  await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal: serverPal, adultOnFile: true } }));
  await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  await page.addInitScript(({ ownerId, appearance, personality, voice }) => {
    const stamp = "2026-10-04T12:00:00.000Z";
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax_account_owner", ownerId);
    window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId, name: "Ripley",
      adultAttestedAt: stamp, appearance, personality, voice, muted: false, hidden: false,
      proposalPreferences: {}, masteryPoints: 0, createdAt: stamp, updatedAt: stamp,
    }));
  }, { ownerId: ACCOUNTS.A.id, ...DEFAULT_PAL_DRAFT });
  await seedSignedIn(page, "A");
  await page.goto("/pal");

  const card = page.getByTestId("pal-night-question");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("Right. Quiet couple, or is it one of those nights?");
  const choices = card.getByRole("link");
  await expect(choices).toHaveCount(3);
  // The page renders again once the server's Pal lands, so each choice is
  // measured only once it is on screen.
  for (const choice of await choices.all()) {
    await expect(choice).toBeVisible();
    await expect.poll(async () => (await choice.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await mkdir(SHOTS, { recursive: true });
  await card.screenshot({ path: `${SHOTS}/question-390.png` });

  await card.getByRole("link", { name: /Proper sesh/ }).click();
  await expect(page).toHaveURL(/\/plan\?query=4\+pubs\+tonight%2C\+lively\+and\+cheap/);

  // Back on /pal the same evening, the Pal answers instead of asking again.
  await page.goto("/pal");
  const answered = page.getByTestId("pal-night-question");
  await expect(answered.getByRole("status")).toHaveText("Proper sesh it is. Four pubs, cheapest first.", { timeout: 60_000 });
  await expect(answered.getByRole("link", { name: "Open the plan" })).toBeVisible();
  await answered.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await answered.screenshot({ path: `${SHOTS}/answered-390.png` });
});
