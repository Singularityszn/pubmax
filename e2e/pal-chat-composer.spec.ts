import { expect, test, type Page } from "@playwright/test";

// The Pub Pal's composer, measured on a production build.
//
// The transcript ends where its content ends and the page scrolls, so after a
// long answer the field sat below the fold with nothing on screen to type
// into (docs/proof/messaging-ui/before/pal-asked-390x844-light.png). It is
// pinned now: on screen after an ask, clear of the tab bar's pill, and still
// on screen under a keyboard-sized cut of the viewport.

const PHONE = { width: 390, height: 844 };
const PHONE_WITH_KEYBOARD = { width: 390, height: 480 };

async function expectComposerInView(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const dock = await page.locator(".palChatComposer").boundingBox();
  expect(dock).not.toBeNull();
  expect(dock!.y).toBeGreaterThanOrEqual(0);
  expect(dock!.y + dock!.height).toBeLessThanOrEqual(viewport!.height + 1);
  const pill = page.locator(".mobileTabList");
  if ((await pill.count()) > 0 && (await pill.isVisible())) {
    const pillBox = await pill.boundingBox();
    expect(dock!.y + dock!.height).toBeLessThanOrEqual(pillBox!.y + 1);
  }
  const owner = await page.evaluate(() => {
    const field = document.querySelector(".palChatInput");
    if (!field) return "missing";
    const rect = field.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return top === field ? "field" : `${top?.tagName.toLowerCase()}.${top?.className ?? ""}`;
  });
  expect(owner).toBe("field");
}

test.describe("the Pub Pal composer on a phone", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("stays on screen after an ask, and the floating compose control stands down", async ({ page }) => {
    await page.goto("/pal/chat");
    await expectComposerInView(page);
    await expect(page.locator(".createFabRoot")).toBeHidden();

    await page.locator(".palChatInput").fill("cheap pint near Bank");
    await page.locator(".palChatSend").click();
    await expect(page.locator(".palChatRow--user")).toHaveCount(1);
    await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".palChatRow--pal .palChatBubble").last()).toBeVisible();
    await expectComposerInView(page);
  });

  test("keeps the composer on screen with the keyboard up", async ({ page }) => {
    await page.goto("/pal/chat");
    await page.locator(".palChatInput").fill("cheap pint near Bank");
    await page.locator(".palChatSend").click();
    await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, { timeout: 15_000 });
    await page.setViewportSize(PHONE_WITH_KEYBOARD);
    await page.locator(".palChatInput").focus();
    await expectComposerInView(page);
  });
});
