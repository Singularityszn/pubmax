import { expect, type Locator, type Page, test } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);
}

async function expectTouchHeight(locator: Locator, minHeight = 44) {
  await expect(locator).toBeVisible();
  await expect
    .poll(async () => (await locator.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(minHeight);
}

test("mobile Plan flow stays tappable and usable at 390px", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });

  const response = await page.goto("/plan");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Describe the outing. We’ll put it in order." })).toBeVisible();
  await page.waitForLoadState("networkidle");
  // This test exercises the full composer (its own template chips, editable
  // context fields), which needs the wizard's own "Describe instead" skip,
  // not the describe-first entry surface's own free-text field.
  await page.getByRole("button", { name: "Guide me instead" }).click();
  await page.getByRole("button", { name: "Describe instead" }).click();
  await expectTouchHeight(page.getByRole("textbox", { name: "Describe the outing" }));
  await expectTouchHeight(page.getByRole("button", { name: "Make a plan" }));
  await expectNoHorizontalOverflow(page);

  const templateChips = page.locator(".planComposer__template");
  const templateCount = await templateChips.count();
  expect(templateCount).toBeGreaterThan(0);
  for (let index = 0; index < templateCount; index += 1) {
    await expectTouchHeight(templateChips.nth(index));
  }

  await page.getByRole("button", { name: "Watch the match" }).click();
  await expect(page.getByLabel("Describe the outing")).toHaveValue("pubs screening live sport tonight in Clapham");
  await expectNoHorizontalOverflow(page);

  await page.getByLabel("Describe the outing").fill("Quiet in Clapham for 4, not pricey");
  await page.getByRole("button", { name: "Make a plan" }).click();

  await expect(page.locator("#plan-concierge-status")).toContainText("stops we can stand behind");
  // The route is the page. Every setting is one tap away, in the Tune details sheet.
  await expect(page.locator(".planComposer__context")).toHaveCount(0);
  await page.getByRole("button", { name: "Tune details" }).click();
  await expect(page.getByRole("combobox", { name: "Area" })).toHaveValue("clapham");
  await expect(page.getByRole("spinbutton", { name: "People" })).toHaveValue("4");

  const contextControls = page.locator(".planComposer__context label");
  const contextControlCount = await contextControls.count();
  expect(contextControlCount).toBe(8);
  for (let index = 0; index < contextControlCount; index += 1) {
    await expectTouchHeight(contextControls.nth(index));
  }
  const editableContextControls = page.locator(".planComposer__context select, .planComposer__context input");
  const editableContextControlCount = await editableContextControls.count();
  expect(editableContextControlCount).toBe(8);
  for (let index = 0; index < editableContextControlCount; index += 1) {
    await expectTouchHeight(editableContextControls.nth(index));
  }
  for (const name of ["Budget", "Drinks", "Time", "Group"]) {
    const control = page.getByRole("combobox", { name });
    await expect(control).toBeVisible();
    const legible = await control.evaluate((element) => {
      const select = element as HTMLSelectElement;
      const label = select.closest("label");
      if (!label) return { ok: false, reason: "no label" };
      const option = select.selectedOptions[0]?.text ?? "";
      const selectBox = select.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      const textFits = select.scrollWidth <= select.clientWidth + 1;
      const insideLabel = selectBox.right <= labelBox.right - 2;
      return { ok: textFits && insideLabel && option.length > 0, option, textFits, insideLabel };
    });
    expect(legible.ok, `${name} pill shows "${legible.option}" without clipping`).toBe(true);
  }
  const maxEach = page.getByRole("spinbutton", { name: "Max per person" });
  await expect(maxEach).toBeVisible();
  await expect(maxEach).toBeEditable();
  const maxEachBox = await maxEach.boundingBox();
  expect(maxEachBox).not.toBeNull();
  expect(maxEachBox!.width).toBeGreaterThanOrEqual(44);
  await page.getByRole("combobox", { name: "Time" }).selectOption("late_night");
  await page.getByRole("spinbutton", { name: "People" }).fill("5");
  await expect(page.getByRole("combobox", { name: "Time" })).toHaveValue("late_night");
  await expect(page.getByRole("spinbutton", { name: "People" })).toHaveValue("5");
  await page.keyboard.press("Escape");
  const regenerateRoute = page.getByRole("button", { name: "Regenerate route" });
  await expectTouchHeight(regenerateRoute);
  await regenerateRoute.click();
  await expect(page.locator("#plan-route-status")).toContainText("Route refreshed");

  await page.getByText("Area coverage", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Crawl-ready", exact: true })).toBeVisible();
  await expectTouchHeight(page.getByRole("link", { name: "Explore Clapham pubs on the map" }));
  await expectNoHorizontalOverflow(page);

  await expectTouchHeight(page.locator(".planStop__surface").first());
  await expectTouchHeight(page.getByRole("button", { name: /^Swap stop 1/ }));
  await expectTouchHeight(page.getByRole("button", { name: "Remove stop 1" }));
  await expectTouchHeight(page.getByRole("button", { name: "Add another stop" }));
  await expectTouchHeight(page.getByRole("button", { name: "Lock it in" }), 48);

  // THE ANSWER IS REACHABLE. PlanAstra measured this primary roughly 40%
  // under the tab bar at 390, with the floating create action over its right
  // edge. Height alone never said so: the control was the right size and in
  // the wrong place, so the assertion is whether a thumb landing on its centre
  // reaches it.
  const lockIn = page.getByRole("button", { name: "Lock it in" });
  await expect(lockIn).toBeInViewport({ ratio: 0.99 });
  const lockOwner = await lockIn.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (!hit) return "nothing";
    if (hit === button || button.contains(hit)) return "lock";
    if (hit.closest(".mobileTabBar")) return "tab bar";
    if (hit.closest(".createFabRoot")) return "create action";
    return hit.tagName.toLowerCase();
  });
  expect(lockOwner).toBe("lock");

  // ONE PAINTED PRIMARY. With a route on the page the concierge control keeps
  // its place and its size and says what it now does, without a second coral
  // fill competing with the action above.
  await page.getByRole("button", { name: "Tune details" }).click();
  const resort = page.getByRole("button", { name: "Sort it again" });
  await expect(resort).toBeVisible();
  await expect(page.getByRole("button", { name: "Make a plan" })).toHaveCount(0);
  const fills = await page.evaluate(() => {
    const paint = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).backgroundColor : null;
    };
    return {
      lock: paint(".planComposer__submit"),
      resort: paint(".planComposer__resort"),
    };
  });
  expect(fills.resort).toBe("rgba(0, 0, 0, 0)");
  expect(fills.lock).not.toBe("rgba(0, 0, 0, 0)");
  await page.keyboard.press("Escape");

  // The first tab stop is a tab stop, not a box in the middle of the form.
  // A transformed ancestor turned the old translate-away into a few pixels.
  const skipLink = page.locator(".skipLink");
  await expect(skipLink).toHaveCount(1);
  const skipBox = await skipLink.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(skipBox.width).toBeLessThanOrEqual(1);
  expect(skipBox.height).toBeLessThanOrEqual(1);
  await skipLink.focus();
  await expect(skipLink).toBeInViewport({ ratio: 0.99 });

  await page.getByLabel("Your name").fill("Terra");
  await page.getByRole("button", { name: "Lock it in" }).click();

  // Lock lands on the plan page at its share step (#share since #816).
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(#share)?$/);
  await expect(page.getByRole("heading", { name: /Who.s in/ })).toBeVisible();
  await expect(page.getByText("Terra", { exact: true })).toBeVisible();
  await expectTouchHeight(page.getByRole("button", { name: "In", exact: true }));
  await expectTouchHeight(page.getByRole("button", { name: "On the way", exact: true }));
  await expectNoHorizontalOverflow(page);
});
