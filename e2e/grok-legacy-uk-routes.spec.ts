import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});

for (const route of ["/map/uk", "/map/uk/1"]) {
  test(`${route} opens the national map through its permanent redirect`, async ({ page, request }) => {
    const redirect = await request.get(route, { maxRedirects: 0 });
    expect(redirect.status()).toBe(308);
    expect(redirect.headers().location).toBe("/map?uk=1");
    await page.goto(route);
    await expect(page).toHaveURL(/\/map\?uk=1$/);
    await expect(page.locator(".mapCanvasWrap")).toHaveAttribute("data-uk-base-status", "zoom_required", { timeout: 30_000 });
    await expect(page.locator(".mapCanvasWrap")).toHaveAttribute("data-uk-base-count", "0");
    await page.screenshot({ path: test.info().outputPath("national-map.png") });
  });
}
