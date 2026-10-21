import { expect, test, type Locator } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function face(badge: Locator) {
  await expect(badge).toBeVisible();
  return badge.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color, background: style.backgroundColor,
      font: style.fontFamily, weight: style.fontWeight, size: style.fontSize,
      numbers: style.fontVariantNumeric, radius: style.borderRadius,
      border: style.border, shadow: style.boxShadow,
    };
  });
}

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`prices keep the shared face and serving comparison at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((value) => {
        localStorage.setItem("pubmax-theme", value);
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
      }, theme);
      await page.goto("/pubs/venue-e1srzr");
      const pubPrice = page.locator(".price-plaque").filter({ hasText: /^£6\.25$/ }).first();
      await expect(pubPrice).toHaveAttribute("title", /^Expensive:/);
      const pubFace = await face(pubPrice);

      await page.route("**/api/pub-pal/chat", (route) => {
        expect(route.request().method()).toBe("POST");
        expect(route.request().postDataJSON().query).toBe("Show the recorded prices");
        return route.fulfill({ json: {
          answer: "Two recorded prices with different serving evidence.",
          cards: [
            { key: "pint", venueId: "venue-e1srzr", title: "Recorded pint", place: "Soho", note: "", price: 6.25, provenance: { kind: "directory", label: "On record" } },
            { key: "glass", venueId: "venue-e1srzr", title: "Recorded glass", place: "Soho", note: "", price: 6.25, provenance: { kind: "community-price", label: "People-logged" } },
          ],
          proposals: [], sources: [], status: "ready", toolsUsed: [],
        } });
      });
      await page.goto("/pal/chat");
      const composer = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
      await expect(composer).toBeEnabled();
      await composer.fill("Show the recorded prices");
      await expect(composer).toHaveValue("Show the recorded prices");
      await page.getByRole("button", { name: "Ask", exact: true }).click();
      const pint = page.locator(".palChatCard").filter({ hasText: "Recorded pint" }).locator(".price-plaque");
      const glass = page.locator(".palChatCard").filter({ hasText: "Recorded glass" }).locator(".price-plaque");
      await expect(pint).toHaveText("£6.25");
      await expect(glass).toHaveText("£6.25");
      await expect(pint).toHaveAttribute("title", /^Expensive:/);
      await expect(glass).not.toHaveAttribute("title");
      expect(await face(pint)).toEqual(pubFace);
      const { color, background, border, ...glassShape } = await face(glass);
      const { color: pintColor, background: pintBackground, border: pintBorder, ...pintShape } = pubFace;
      expect(color).not.toBe(pintColor);
      expect(background).not.toBe(pintBackground);
      expect(border).not.toBe(pintBorder);
      expect(glassShape).toEqual(pintShape);
      expect(glassShape.numbers).toBe("tabular-nums");
      expect(glassShape.shadow).toBe("none");
    });
  }
}
