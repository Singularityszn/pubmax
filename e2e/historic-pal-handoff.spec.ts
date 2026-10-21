import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`historic pub Pal action reaches the conversation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem("pubmaxx:analytics-consent:v1", "denied"));
    await page.goto("/historic/the-nellie-dean");
    const actions = page.getByRole("region", { name: "Explore this pub" });
    await actions.getByRole("link", { name: /Ask your Pub Pal/ }).click();
    await expect(page).toHaveURL(/\/pal\/chat$/);
    const composer = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
    await expect(composer).toBeVisible();
    await expect(composer).toBeEnabled();
    await composer.fill("Four pubs in Soho");
    await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeEnabled();
  });
}
