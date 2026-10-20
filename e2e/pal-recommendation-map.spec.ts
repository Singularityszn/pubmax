import { expect, test, type Locator } from "@playwright/test";

async function pinPositions(canvas: Locator) {
  return canvas.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll(".palChatMapAnchor"), (anchor) => {
      const pin = anchor.getBoundingClientRect();
      return { x: Math.round((pin.x - frame.x - frame.width / 2) * 10) / 10, y: Math.round((pin.y - frame.y - frame.height / 2) * 10) / 10 };
    });
  });
}

async function settledPinPositions(canvas: Locator) {
  let previous = "";
  let stable = 0;
  await expect.poll(async () => {
    const current = JSON.stringify(await pinPositions(canvas));
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    return stable;
  }, { intervals: [100] }).toBeGreaterThanOrEqual(3);
  return pinPositions(canvas);
}

test("phone rotation keeps all four answer pins framed until the user moves the camera", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/pal/chat");
  await page.getByRole("textbox", { name: "Where, how many, what budget", exact: true }).fill("Find me four pubs in Soho and show them on the map.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const map = page.getByRole("region", { name: "4 pubs on the map" });
  const canvas = map.locator('.palChatMapCanvas[data-map-ready="true"]');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const ids = await map.locator(".palChatMapPin").evaluateAll((pins) => pins.map((pin) => pin.getAttribute("data-venue-id")));
  expect(ids).toHaveLength(4);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await canvas.scrollIntoViewIfNeeded();
    await expect.poll(() => canvas.evaluate((element) => {
      const frame = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll(".palChatMapPin"), (pin) => {
        const box = pin.getBoundingClientRect();
        const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return box.left >= frame.left && box.right <= frame.right && box.top >= frame.top && box.bottom <= frame.bottom
          && (target === pin || pin.contains(target));
      });
    })).toEqual([true, true, true, true]);
    expect(await map.locator(".palChatMapPin").evaluateAll((pins) => pins.map((pin) => pin.getAttribute("data-venue-id")))).toEqual(ids);
  }
  const framed = await settledPinPositions(canvas);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 65, box!.y + 50, { steps: 15 });
  await page.mouse.up();
  const moved = await settledPinPositions(canvas);
  expect(Math.abs(moved[0]!.x - framed[0]!.x)).toBeGreaterThan(40);
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await canvas.scrollIntoViewIfNeeded();
    const rotated = await settledPinPositions(canvas);
    expect(rotated).toHaveLength(4);
    rotated.forEach((position, index) => {
      expect(Math.abs(position.x - moved[index]!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(position.y - moved[index]!.y)).toBeLessThanOrEqual(1);
    });
  }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`an empty replacement search keeps plain-map navigation at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/pal/chat");
    const field = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
    await field.fill("Find four pubs in Soho");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const map = page.getByRole("region", { name: "4 pubs on the map", exact: true });
    await expect(map.locator('[data-map-ready="true"]')).toBeVisible({ timeout: 20_000 });
    await map.scrollIntoViewIfNeeded();
    for (const pin of await map.locator(".palChatMapPin").all()) await pin.click({ trial: true });
    await page.route("**/api/pub-pal/chat", route => route.fulfill({ json: {
      answer: "No matching listed pubs for the replacement search.", cards: [], proposals: [], sources: [], status: "ready", toolsUsed: ["search_venues"],
    } }));
    await field.fill("Find four pubs in a different area");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("No matching listed pubs for the replacement search.", { exact: true })).toBeVisible();
    await field.fill("Show me the map");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page).toHaveURL(/\/map$/);
  });

  test(`a typed map follow-up retains the four choices and the reader's camera at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/pal/chat");
    const field = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
    await field.fill("Find me four pubs in Soho and show them on the map.");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const map = page.getByRole("region", { name: "4 pubs on the map", exact: true });
    const canvas = map.locator('.palChatMapCanvas[data-map-ready="true"]');
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    const pins = map.locator(".palChatMapPin");
    const ids = await pins.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-venue-id")));
    expect(ids).toHaveLength(4);
    await canvas.scrollIntoViewIfNeeded();
    for (const pin of await pins.all()) await pin.click({ trial: true });
    const identity = await map.locator("canvas").elementHandle();
    const box = await canvas.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 30);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 25, box!.y + 40, { steps: 10 });
    await page.mouse.up();
    const moved = await settledPinPositions(canvas);
    await map.screenshot({ path: testInfo.outputPath("choices-before-map-followup.png") });
    await field.fill("Show me the map");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(map).toBeFocused();
    await expect(page).toHaveURL(/\/pal\/chat$/);
    expect(await map.locator("canvas").evaluate((node, old) => node === old, identity)).toBe(true);
    expect(await settledPinPositions(canvas)).toEqual(moved);
    expect(await pins.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-venue-id")))).toEqual(ids);
    for (const pin of await pins.all()) await pin.click({ trial: true });
    await map.screenshot({ path: testInfo.outputPath("choices-after-map-followup.png") });
  });

  test(`repeated budget follow-ups retain Soho through reload at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto("/pal/chat");
    const composer = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
    await composer.fill("Find me four pubs in Soho and show them on the map.");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator(".palChatCards .palChatCard")).toHaveCount(4);
    for (const [index, budget] of [6.80, 6.70, 6.60, 6.50].entries()) {
      if (index === 3) await page.reload();
      await composer.fill(`Same area, under £${budget.toFixed(2)} a pint`);
      const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/pub-pal/chat" && response.request().method() === "POST");
      await page.getByRole("button", { name: "Ask", exact: true }).click();
      expect((await responsePromise).ok()).toBe(true);
      await expect(page.locator(".palChatCards")).toHaveCount(index + 2);
      const reply = page.locator(".palChatRow--pal").last();
      await expect(reply.locator(".palChatLocality")).toHaveText("In Soho, the area you named.");
      await expect(reply.locator(".palChatRecall")).toHaveCount(0);
      await expect(reply).toContainText("Shakespeares Head");
      await expect(reply).not.toContainText("Name a listed pub to check a price");
      const prices = await reply.locator(".palChatCardPrice").allTextContents();
      expect(prices.length).toBeGreaterThan(0);
      for (const price of prices) expect(Number(price.replace(/[^0-9.]/g, ""))).toBeLessThanOrEqual(budget);
    }
  });

  test(`four Soho recommendations stay with their map at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/pal/chat");
    await page.getByRole("textbox", { name: "Where, how many, what budget" }).fill(
      "Find me four pubs in Soho and show them on the map.",
    );
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator(".palChatCards .palChatCard")).toHaveCount(4);
    await expect(page).toHaveURL(/\/pal\/chat$/);
    const map = page.getByRole("region", { name: "4 pubs on the map" });
    await expect(map).toBeVisible();
    await expect(map.locator('.palChatMapCanvas[data-map-ready="true"]')).toBeVisible({ timeout: 20_000 });
    await expect(map.locator(".palChatMapPin")).toHaveCount(4);
    const pinBoxes = await map.locator(".palChatMapPin").evaluateAll((pins) => pins.map((pin) => {
      const box = pin.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    for (let first = 0; first < pinBoxes.length; first += 1) {
      const a = pinBoxes[first]!;
      expect(a.width).toBeGreaterThanOrEqual(44);
      for (let second = first + 1; second < pinBoxes.length; second += 1) {
        const b = pinBoxes[second]!;
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
      }
    }
    const tappable = await map.locator(".palChatMapPin").evaluateAll((pins) => pins.map((pin) => {
      const box = pin.getBoundingClientRect();
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return target === pin || pin.contains(target);
    }));
    expect(tappable).toEqual([true, true, true, true]);
    for (const name of await page.locator(".palChatCardTitle").allTextContents()) {
      await expect(map).toContainText(name);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `artifacts/pubpal-complete-1019/soho-map-${viewport.width}.png` });
    const pin = map.locator(".palChatMapPin").first();
    const selectedId = await pin.getAttribute("data-venue-id");
    await pin.click();
    await expect(page).toHaveURL(new RegExp(`/map\\?sel=${selectedId}`));
    await expect(page.locator(".venueInspector")).toBeAttached({ timeout: 30_000 });
    await expect(page.locator(".venueInspector")).toContainText("Shakespeares Head");
    await page.goBack();
    if (new URL(page.url()).pathname === "/map") await page.goBack();
    await expect(page).toHaveURL(/\/pal\/chat$/);
    await expect(page.locator(".palChatCards .palChatCard")).toHaveCount(4);
    await expect(page.getByRole("region", { name: "4 pubs on the map" })).toBeVisible();
    await page.getByRole("textbox", { name: "Where, how many, what budget" }).fill("Same area, but under £6.50 a pint.");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const refined = page.locator(".palChatCards").last();
    await expect(page.locator(".palChatCards")).toHaveCount(2);
    await expect(refined).toContainText("Shakespeares Head");
    await expect(refined).not.toContainText("Comptons of Soho");
    const prices = await refined.locator(".palChatCardPrice").allTextContents();
    expect(prices.length).toBeGreaterThan(0);
    for (const price of prices) expect(Number(price.replace(/[^0-9.]/g, ""))).toBeLessThanOrEqual(6.5);
    await page.getByRole("textbox", { name: "Where, how many, what budget" }).fill("Same area, but under £6.30 a pint.");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator(".palChatCards")).toHaveCount(3);
    await expect(refined).toContainText("Shakespeares Head");
    await expect(refined).not.toContainText("Golden Lion");
    await page.getByRole("button", { name: "New conversation", exact: true }).click();
    await expect(page.locator(".palChatCards .palChatCard")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Where, how many, what budget" })).toBeFocused();
    await page.reload();
    await expect(page.locator(".palChatCards .palChatCard")).toHaveCount(0);
  });
}
