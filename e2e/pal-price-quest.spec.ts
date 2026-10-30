import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { attachBill, readPriceSubmission } from "./helpers/priceBill";

// The Pal's price quest (components/pal/PalQuest.tsx): on /near the person's
// own Pal asks today's price evidence mission in its own words, answering it
// lands the day's stamp, and the stamp waits in the Pal's book on /pal
// (components/pal/PalQuestStamps.tsx). The mission and the write are answered
// here, so the test reads the screens. Shots land in artifacts/pal-quest/.

const SHOTS = "artifacts/pal-quest";
const PAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function seedQuest(page: Page, palOwner: string) {
  await installAuthDoubles(page);
  const now = "2026-01-01T12:00:00.000Z";
  const serverPal = {
    id: PAL_ID, ownerId: ACCOUNTS.A.id, adultAttestedAt: now, ...DEFAULT_PAL_DRAFT, name: "Ripley",
    muted: false, hidden: false, proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
  };
  await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal: serverPal, adultOnFile: true } }));
  await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  await page.route("**/api/pint-drops/stats?**", (route) => route.fulfill({
    json: { stats: { handle: ACCOUNTS.A.handle, pintsMapped: 0, total: 0, streak: { current: 0, best: 0 }, byBorough: [] } },
  }));
  await page.route("**/api/price-missions**", (route) => {
    const venueId = new URL(route.request().url()).searchParams.get("venueId");
    return route.fulfill({
      json: {
        status: "ready",
        mission: { venueId, reason: "provisional", drinkCategory: "beer", observedAt: Date.now() - 3_600_000 },
      },
    });
  });
  const submitted: string[] = [];
  await page.route("**/api/price-submit**", (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { prices: [], signals: [] } });
    const body = readPriceSubmission(route.request()) as { venueId?: string };
    submitted.push(body?.venueId ?? "");
    const price = {
      venueId: body?.venueId, drinkCategory: "beer", priceGbp: 4.2, submittedAt: Date.now(), source: "community", corroborations: 1,
    };
    return route.fulfill({ status: 201, json: { price, attribution: { status: "credited", handle: ACCOUNTS.A.handle }, pintTrust: "logged-once" } });
  });
  await page.addInitScript(({ ownerId, palOwner: storedOwner, appearance, personality, voice, palId }) => {
    const now = "2026-01-01T12:00:00.000Z";
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax_account_owner", ownerId);
    window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
      id: palId, ownerId: storedOwner, name: "Ripley", adultAttestedAt: now, appearance, personality, voice,
      muted: false, hidden: false, proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    }));
  }, { ownerId: ACCOUNTS.A.id, palOwner, palId: PAL_ID, ...DEFAULT_PAL_DRAFT });
  await seedSignedIn(page, "A");
  return { submitted };
}

test("the Pal asks today's price quest, stamps it once, and keeps the stamp in its book", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { submitted } = await seedQuest(page, ACCOUNTS.A.id);
  await page.goto("/near?patch=soho", { waitUntil: "domcontentloaded" });

  const quest = page.getByTestId("pal-quest");
  await expect(quest).toBeVisible({ timeout: 60_000 });
  await expect(quest).toHaveAttribute("data-state", "ask");
  await expect(quest.locator(".palQuestLine")).toContainText(/^Ripley's quest for today: one person logged a price at .+\. Can you check it\?$/);
  await expect(quest).toContainText("No need to buy anything. Read the board or ask at the bar.");
  const slot = page.locator(".pemSlot");
  const pub = (await quest.locator(".palQuestLine").textContent())!.match(/price at (.+)\. Can you/)![1]!;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/quest-ask-390.png` });

  // The quest is answered through the mission's own form, bill and all.
  await slot.getByRole("button", { name: "Log it" }).click();
  await slot.getByRole("textbox").fill("4.20");
  await attachBill(slot);
  await slot.getByRole("button", { name: "Log it" }).last().click();
  await expect(quest).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  await expect(quest.locator(".palQuestLine")).toHaveText(`Quest done. Ripley stamped ${pub} in your book.`);
  await expect(quest.locator(".palStamp")).toContainText(pub);
  expect(submitted).toHaveLength(1);
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: `${SHOTS}/quest-done-390.png` });

  // One quest a day: back on /near the same day, the mission is plain.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".pemSlot")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("pal-quest")).toHaveCount(0);

  // The stamp waits in the Pal's book, with no count beside it.
  await page.goto("/pal");
  const book = page.getByTestId("pal-stamp-book");
  await expect(book).toBeVisible({ timeout: 60_000 });
  await expect(book.locator(".palStamp")).toHaveCount(1);
  await expect(book.locator(".palStampPub")).toHaveText(pub);
  await expect(book).not.toContainText(/\b\d+ stamps?\b|streak|level/i);
  await book.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/stamp-book-390.png` });
});

test("another account's stored Pal asks no quest, and the mission stays plain", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await seedQuest(page, ACCOUNTS.B.id);
  await page.goto("/near?patch=soho", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".pemSlot")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("pal-quest")).toHaveCount(0);
});
