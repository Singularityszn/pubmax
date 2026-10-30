import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// The Pal's evening question on /pal (components/pal/PalNightQuestion.tsx):
// "Right. Quiet pint, or a big one tonight?", and each answer opens a
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
  await expect(card).toContainText("Right. Quiet pint, or a big one tonight?");
  const choices = card.getByRole("link");
  await expect(choices).toHaveCount(3);
  // The page renders again once the server's Pal lands, so each choice is
  // measured only once it is on screen.
  for (const choice of await choices.all()) {
    await expect(choice).toBeVisible();
    await expect.poll(async () => (await choice.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await mkdir(SHOTS, { recursive: true });
  await expect(async () => {
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await card.screenshot({ path: `${SHOTS}/question-390.png` });
  }).toPass({ timeout: 30_000 });

  await card.getByRole("link", { name: /Big one tonight/ }).click();
  await expect(page).toHaveURL(/\/plan\?query=4\+pubs\+tonight%2C\+lively\+and\+cheap/);

  // Back on /pal the same evening, the Pal answers instead of asking again.
  await page.goto("/pal");
  const answered = page.getByTestId("pal-night-question");
  await expect(answered.getByRole("status")).toHaveText("A big one it is. Four lively pubs, on a budget, and mind the last train.", { timeout: 60_000 });
  await expect(answered.getByRole("link", { name: "Open the plan" })).toBeVisible();
  await expect(async () => {
    await answered.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await answered.screenshot({ path: `${SHOTS}/answered-390.png` });
  }).toPass({ timeout: 30_000 });
});

test("once tonight's plan is saved, the Pal hands out the crew link", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date("2026-10-19T18:30:00Z") });
  await installAuthDoubles(page);
  const planId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const inviteToken = "0123456789abcdef0123456789abcdef";
  const now = "2026-10-04T12:00:00.000Z";
  const serverPal = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
    adultAttestedAt: now, ...DEFAULT_PAL_DRAFT, name: "Ripley", muted: false, hidden: false,
    proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
  };
  await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal: serverPal, adultOnFile: true } }));
  await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  // The member's own plan read hands back the crew token, as it does for a host.
  await page.route(`**/api/plans/${planId}`, (route) => route.fulfill({ json: { inviteToken, stops: [] } }));
  await page.addInitScript(({ ownerId, id, appearance, personality, voice }) => {
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
    // Tonight's answer, and the plan the host locked in for half eight.
    window.localStorage.setItem("pubmax:pal-night-answer:v1", JSON.stringify({ evening: "2026-10-19", answer: "big" }));
    window.localStorage.setItem("pubmax_active_plan", JSON.stringify({
      version: 1, id, startTime: "2026-10-19T19:30:00.000Z", stopIndex: 0, role: "host",
    }));
    // Capture the share sheet instead of opening it.
    const shared: unknown[] = [];
    (window as unknown as { __shared: unknown[] }).__shared = shared;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: unknown) => { shared.push(data); },
    });
  }, { ownerId: ACCOUNTS.A.id, id: planId, ...DEFAULT_PAL_DRAFT });
  await seedSignedIn(page, "A");
  await page.goto("/pal");

  const card = page.getByTestId("pal-night-question");
  await expect(card.getByRole("status").first()).toHaveText("A big one it is. Four lively pubs, on a budget, and mind the last train.", { timeout: 60_000 });
  const who = card.getByRole("button", { name: "Who's coming?" });
  await expect(who).toBeVisible({ timeout: 30_000 });
  // The page renders again as the server's Pal and the plan read land.
  await mkdir(SHOTS, { recursive: true });
  await expect(async () => {
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await card.screenshot({ path: `${SHOTS}/crew-390.png` });
  }).toPass({ timeout: 30_000 });

  await who.click();
  await expect(card).toContainText("Sent. Now they tap Going.");
  const shared = await page.evaluate(() => (window as unknown as { __shared: Array<{ text: string; url: string }> }).__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0]!.text).toBe("Ripley's got a plan for tonight. Open the link and tap Going.");
  expect(new URL(shared[0]!.url).pathname).toBe(`/invite/${inviteToken}`);
});
