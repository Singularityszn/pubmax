import { expect, test } from "@playwright/test";

import { CONTACT_EMAIL } from "../lib/siteContact";
import { capturePublicPageEvidence } from "./helpers/publicPageEvidence";

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`signed-out feedback and email fallback at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/u/you");
    await expect(page.getByRole("heading", { name: "Claim your @handle." })).toBeVisible();
    const feedback = page.getByRole("link", { name: "Send feedback", exact: true });
    await feedback.click();

    await expect(page).toHaveURL(/\/feedback$/);
    await expect(page.getByRole("heading", { name: "Tell us what needs a fix." })).toBeVisible();
    const draft = page.getByRole("link", { name: "Open email draft", exact: true });
    const target = new URL((await draft.getAttribute("href"))!);
    expect(target.protocol).toBe("mailto:");
    expect(target.pathname).toBe(CONTACT_EMAIL);
    expect([...target.searchParams]).toEqual([["subject", "PUBMAXX feedback"]]);
    await draft.focus();
    await expect(draft).toBeFocused();
    const bounds = await draft.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);

    const fallback = page.getByRole("region", { name: "No email app?" });
    await fallback.scrollIntoViewIfNeeded();
    await expect(fallback.getByText(CONTACT_EMAIL, { exact: true })).toBeVisible();
    await expect(fallback).toContainText("Copy this address into the email service you use");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

    await page.getByRole("link", { name: "Back to You", exact: true }).click();
    await expect(page).toHaveURL(/\/u\/you$/);
    await expect(page.getByRole("link", { name: "Send feedback", exact: true })).toBeVisible();
  });
}

test("feedback ignores query strings and fragments", async ({ page }) => {
  await page.goto("/feedback?from=%2Fmessages%2Fprivate-example&handle=private-example&lat=51.5#private-example");
  const target = new URL((await page.getByRole("link", { name: "Open email draft", exact: true }).getAttribute("href"))!);
  expect([...target.searchParams]).toEqual([["subject", "PUBMAXX feedback"]]);
  expect(target.hash).toBe("");
  await expect(page.getByRole("main")).not.toContainText("private-example");
});

if (process.env.PUBMAX_PUBLIC_EVIDENCE_PHASE) {
  test.use({ trace: "off", video: "off" });
  test.describe("public screenshot evidence", () => {
    test("records the signed-out feedback source and viewport images", async ({ page }, testInfo) => {
      await capturePublicPageEvidence(page, testInfo, "feedback");
    });
  });
}
