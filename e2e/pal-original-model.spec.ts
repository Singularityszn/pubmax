import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { uiUxChromiumProjectUse } from "../scripts/lib/uiUxBattleTestBrowser.mjs";

async function imageDifference(left: Buffer, right: Buffer): Promise<number> {
  const [a, b] = await Promise.all([left, right].map(bytes => sharp(bytes).resize(64, 64).removeAlpha().raw().toBuffer()));
  return a.reduce((sum, channel, index) => sum + Math.abs(channel - b[index]), 0) / a.length;
}

test.use(uiUxChromiumProjectUse(process.env.UI_UX_BROWSER_CHANNEL));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
});

for (const width of [390, 1440]) {
  test(`${width}px: the first visit loads only Robin, supports turning and restores after Back`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const requests: string[] = [];
    page.on("request", request => {
      if (request.url().endsWith(".glb")) requests.push(new URL(request.url()).pathname);
    });
    await page.goto("/pal");
    const model = page.getByRole("img", { name: /Unclaimed Pub Pal in 3D/ });
    await expect(model).toBeVisible();
    await expect(model.locator("canvas")).toBeVisible();
    const pixels = await sharp(await model.locator("canvas").screenshot()).ensureAlpha().raw().toBuffer();
    let coral = 0;
    let cyan = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      if (r > 100 && r > g * 1.5 && r > b * 1.1) coral += 1;
      if (g > 120 && g > r * 1.2 && b > r * 1.2) cyan += 1;
    }
    expect(coral, "Robin must retain the original coral chest texture").toBeGreaterThan(200);
    expect(cyan, "Robin must retain the original cyan eyes").toBeGreaterThan(10);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(/^\/brand\/pals\/circuit-robin-[a-f0-9]{12}\.glb$/);
    await model.focus();
    await expect(model).toBeFocused();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    // Both reference and reset force the latest frozen pose to render.
    // The previous reference could be the older frame from the 30 fps cap.
    await model.press("Home");
    const front = await model.screenshot();
    for (let turn = 0; turn < 4; turn += 1) await model.press("ArrowRight");
    const turned = await model.screenshot();
    expect(await imageDifference(front, turned), "ArrowRight must turn the rendered geometry").toBeGreaterThan(3);
    await testInfo.attach("turned-original", { body: turned, contentType: "image/png" });
    await model.press("Home");
    expect(await imageDifference(front, await model.screenshot()), "Home must restore the original front view").toBeLessThan(1);
    await page.clock.resume();
    await page.screenshot({ path: testInfo.outputPath(`original-robin-${width}.png`) });
    await page.getByRole("link", { name: "Back to the map", exact: true }).click();
    await expect(page).toHaveURL(/\/map$/);
    await page.goBack();
    await expect(model).toBeVisible();
    await expect(model.locator("canvas")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("a failed model keeps the original artwork and meeting action usable", async ({ page }) => {
  await page.route("**/brand/pals/*.glb", route => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/pal");
  const portrait = page.locator(".palMeetingPortrait");
  await expect(portrait.locator('[data-model-state="model-unavailable"]')).toHaveCount(1);
  await expect(portrait.getByRole("img", { name: "Pub Pal", exact: true })).toBeVisible();
  await expect(portrait.locator("canvas")).toHaveCount(0);
  const meet = page.getByRole("button", { name: "Meet your Pub Pal", exact: true });
  await expect(async () => {
    await meet.click();
    await expect(page.getByRole("heading", { name: "The grown-up bit first.", exact: true })).toBeVisible({ timeout: 1_000 });
  }).toPass();
});

test("the typed conversation keeps the original 3D Pal visible after a real answer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pal/chat");
  const companion = page.locator(".palChatCompanion");
  await expect(companion.getByRole("img", { name: /Pub Pal in 3D/ })).toBeVisible();
  const field = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
  await expect(field).toBeEnabled();
  await field.fill("Find four pubs in Soho and show them on the map.");
  await page.locator(".palChatSend").click();
  await expect(page.locator(".palChatRow--user")).toHaveCount(1);
  await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".palChatRow--pal .palChatBubble").last()).toBeVisible();
  await companion.scrollIntoViewIfNeeded();
  await expect(companion.locator("canvas")).toBeVisible();
});

test("unavailable WebGL retains the still original artwork", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return Reflect.apply(getContext, this, [type, ...args]);
    } as typeof getContext;
  });
  await page.goto("/pal");
  await expect(page.locator('[data-model-state="graphics-unavailable"]')).toHaveCount(1);
  await expect(page.getByRole("img", { name: "Pub Pal", exact: true })).toBeVisible();
  await expect(page.locator(".palPortrait canvas")).toHaveCount(0);
});

test("changing motion preference disposes the model and restores it on demand", async ({ page }) => {
  await page.goto("/pal");
  const model = page.getByRole("img", { name: /Unclaimed Pub Pal in 3D/ });
  await expect(model).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".palPortrait canvas")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Pub Pal", exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(model).toBeVisible();
  await expect(model.locator("canvas")).toHaveCount(1);
});
