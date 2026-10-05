import { expect, type Page } from "@playwright/test";

/**
 * Walk the first-run questions from the London confirm to the Pub Pal step:
 * budget, a London patch instead of a location prompt, and the result. Every
 * spec that only cares about the Pal step or the plan handoff goes through
 * here, so the day a question moves there is one place to follow it.
 */
export async function answerFirstRunQuestions(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Use London" }).click();
  await page.getByRole("button", { name: "£6 or less" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Pick a London patch instead" }).click();
  await page.getByRole("button", { name: "Soho" }).click();
  await expect(page.getByRole("button", { name: "That looks right" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "That looks right" }).click();
  await expect(page.getByRole("heading", { name: "Pick your Pub Pal." })).toBeVisible();
}
