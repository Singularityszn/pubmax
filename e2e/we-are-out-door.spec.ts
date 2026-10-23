import { expect, test } from "@playwright/test";

// QA journeys, 6 Oct 2026, F18. Signed out, /we-are-out opened the full form and
// only a submit answered "Choose a handle in your account first." with no link.
// The page now opens on a sign-in door that carries the way back.

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`/we-are-out signed out opens a sign-in door at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/we-are-out");

    const door = page.locator(".weAreOutDoor");
    await expect(door).toContainText("Sign in to tell your lot.");
    await expect(page.locator(".weAreOut select")).toHaveCount(0);
    const signIn = door.getByRole("link", { name: "Sign in" });
    await expect(signIn).toHaveAttribute("href", "/login?from=%2Fwe-are-out");
    const box = await signIn.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
