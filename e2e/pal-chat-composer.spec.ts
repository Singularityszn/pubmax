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
  // The layout renders the tab bar in two places, and while the page streams
  // in both can be in the document, one hidden. Read the one a reader sees.
  const pill = page.locator(".mobileTabList").filter({ visible: true });
  if ((await pill.count()) > 0) {
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

  test("stays on screen after an ask, with no floating compose control over it", async ({ page }) => {
    await page.goto("/pal/chat");
    await expectComposerInView(page);
    // The floating create action left with the five-tab dock (1 Nov 2026).
    await expect(page.locator(".createFabRoot")).toHaveCount(0);

    const field = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
    await expect(field).toBeEnabled();
    await field.click();
    await field.fill("cheap pint near Bank");
    await expect(field).toHaveValue("cheap pint near Bank");
    await page.locator(".palChatSend").click();
    await expect(page.locator(".palChatRow--user")).toHaveCount(1);
    await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".palChatRow--pal .palChatBubble").last()).toBeVisible();
    await expectComposerInView(page);
  });

  test("keeps the composer on screen with the keyboard up", async ({ page }) => {
    await page.goto("/pal/chat");
    const field = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
    await expect(field).toBeEnabled();
    await field.click();
    await field.fill("cheap pint near Bank");
    await expect(field).toHaveValue("cheap pint near Bank");
    await page.locator(".palChatSend").click();
    await expect(page.locator(".palChatRow--user")).toHaveCount(1);
    await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, { timeout: 15_000 });
    await page.setViewportSize(PHONE_WITH_KEYBOARD);
    await page.locator(".palChatInput").focus();
    await expectComposerInView(page);
  });
});

// The analytics consent card parks on the foot of the window after the first
// answer (lib/consentAnswerMoment.ts). The composer is sticky, so a reader who
// scrolls back up the thread still has the field on screen, and the card must
// never be the thing on top of it (Pal UI audit, 19 Oct 2026: the field and
// Ask sat under the card at 1440, 1280, 390 and 360 until the page's foot).
for (const viewport of [PHONE, { width: 1280, height: 720 }]) {
  test(`stands on the consent card, never under it, at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
    });
    await page.goto("/pal/chat");
    const field = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
    await expect(field).toBeEnabled();
    await field.click();
    await field.fill("cheap pint near Bank");
    await expect(field).toHaveValue("cheap pint near Bank");
    await page.locator(".palChatSend").click();
    await expect(page.locator(".palChatRow--user")).toHaveCount(1);
    await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, { timeout: 15_000 });
    const card = page.locator(".analyticsConsentPrompt");
    await expect(card).toBeVisible({ timeout: 15_000 });
    // Back to the top of the thread: the composer is pinned, the card is up.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectComposerInView(page);
    const dock = await page.locator(".palChatComposer").boundingBox();
    const cardBox = await card.boundingBox();
    expect(dock!.y + dock!.height).toBeLessThanOrEqual(cardBox!.y + 1);
  });
}
