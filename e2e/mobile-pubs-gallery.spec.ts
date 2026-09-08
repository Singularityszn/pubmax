import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, "page should not horizontally overflow at 390px").toBeLessThanOrEqual(1);
}

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await locator.boundingBox()) !== null, {
      message: `${label} should have a layout box`,
      timeout: 5_000,
    })
    .toBe(true);
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.height, `${label} should meet the 44px mobile tap target`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${label} should be wide enough to tap`).toBeGreaterThanOrEqual(44);
}

async function expectVisibleTargetsTappable(locator: Locator, label: string): Promise<void> {
  const count = await locator.count();
  for (let index = 0; index < Math.min(count, 6); index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) {
      await expectTappable(item, `${label} ${index + 1}`);
    }
  }
}

test.describe("mobile Pubs gallery", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  for (const viewport of [MOBILE, { width: 1440, height: 900 }]) {
    test(`photo card bounds, credit, and metadata at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const response = await page.goto("/pubs");
      expect(response?.status()).toBe(200);

      const card = page.locator(".pubsCard:has(.pubsCardPhoto img)").first();
      await expect(card).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      const image = card.locator(".pubsCardPhoto img");
      await expect.poll(() => image.evaluate((node: HTMLImageElement) =>
        node.complete && node.naturalWidth > 0 && node.naturalHeight > 0,
      )).toBe(true);
      await expect(card.locator(".pubsCardGlyphHero, .pubsCardShelf")).toHaveCount(0);
      await expect(card.locator(".venueImage__provenance")).toHaveText("Photo: pub website");
      await expect(card.locator(".pubsCardArtLabel")).not.toBeEmpty();

      const selectors = {
        art: ".pubsCardArt",
        photo: ".pubsCardPhoto",
        image: ".pubsCardPhoto img",
        credit: ".venueImage__provenance",
        label: ".pubsCardArtLabel",
        body: ".pubsCardBody",
        meta: ".pubsCardMeta",
      };
      for (const selector of Object.values(selectors)) {
        await expect(card.locator(selector)).toBeVisible();
      }
      const boxes = await card.evaluate((node, selectors) => Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => {
          const element = node.querySelector(selector);
          if (!element) throw new Error(`Missing photo card element: ${selector}`);
          return [name, element.getBoundingClientRect().toJSON()];
        }),
      ) as Record<keyof typeof selectors, DOMRect>, selectors);

      expect(boxes.art.height).toBe(viewport.width === MOBILE.width ? 140 : 168);
      expect(boxes.art.bottom).toBeLessThanOrEqual(boxes.body.top + 1);
      for (const name of ["photo", "image", "credit", "label"] as const) {
        expect(boxes[name].left, `${name} left edge`).toBeGreaterThanOrEqual(boxes.art.left - 1);
        expect(boxes[name].right, `${name} right edge`).toBeLessThanOrEqual(boxes.art.right + 1);
        expect(boxes[name].top, `${name} top edge`).toBeGreaterThanOrEqual(boxes.art.top - 1);
        expect(boxes[name].bottom, `${name} bottom edge`).toBeLessThanOrEqual(boxes.art.bottom + 1);
      }
      expect(boxes.label.bottom).toBeLessThanOrEqual(boxes.credit.top);
      expect(boxes.meta.top).toBeGreaterThanOrEqual(boxes.body.top);
      expect(boxes.meta.bottom).toBeLessThanOrEqual(boxes.body.bottom);
      expect(boxes.meta.left).toBeGreaterThanOrEqual(boxes.body.left);
      expect(boxes.meta.right).toBeLessThanOrEqual(boxes.body.right);
      for (const meta of await card.locator(".pubsCardMeta > span").all()) {
        await expect(meta).toBeVisible();
        await expect(meta).not.toBeEmpty();
      }
      await testInfo.attach(`photo-card-${viewport.width}`, {
        body: await card.screenshot(), contentType: "image/png",
      });
    });
  }

  test("filters, cards, and card actions stay thumb-safe and navigable", async ({ page }) => {
    const errors = watchPageErrors(page);
    const response = await page.goto("/pubs");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1, name: /Chains/i })).toBeVisible();
    await expect(page.locator(".pubsCard").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const filters = page.locator(".pubsFilter");
    await expectVisibleTargetsTappable(filters, "pubs filter");
    await expect(filters.first()).toHaveAttribute("aria-pressed", "true");

    const secondFilter = filters.nth(1);
    if (await secondFilter.isVisible()) {
      await secondFilter.click();
      await expect(page).toHaveURL(/source=/);
      await expect(page.locator(".pubsFilter").nth(1)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.locator(".pubsCount")).toContainText(/pub/);
      await expectNoHorizontalOverflow(page);
    }

    const nextPage = page.getByRole("link", { name: "Next" });
    if (await nextPage.isVisible()) {
      await expectTappable(nextPage, "pubs next page link");
    }

    const firstCard = page.locator(".pubsCard").first();
    await expect(firstCard).toBeVisible();
    await expectTappable(firstCard.locator(".pubsCardName a"), "pub card title link");
    await expectTappable(firstCard.locator(".pubsMapLink"), "pub card map link");
    await expectVisibleTargetsTappable(firstCard.locator(".pubsMenuLink"), "pub card menu link");
    await expectVisibleTargetsTappable(firstCard.locator(".pubsBookLink"), "pub card booking link");
    await expectNoHorizontalOverflow(page);

    const mapLink = firstCard.locator(".pubsMapLink");
    await expect(mapLink).toHaveAttribute("href", /\/map\?sel=venue-/);
    await mapLink.click();
    await expect(page).toHaveURL(/\/map\?sel=venue-/, { timeout: 30_000 });
    await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });

    expect(errors).toEqual([]);
  });
});
