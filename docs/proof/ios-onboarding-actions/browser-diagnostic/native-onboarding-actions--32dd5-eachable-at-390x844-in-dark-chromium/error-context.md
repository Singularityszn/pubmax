# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-onboarding-actions.spec.ts >> clean onboarding actions stay reachable at 390x844 in dark
- Location: e2e/native-onboarding-actions.spec.ts:40:9

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/onboarding$/
Received string:  "http://localhost:3811/"
Timeout: 10000ms

Call log:
  - Expect "toHaveURL" with timeout 10000ms
    24 × locator resolved to <html>…</html>
       - unexpected value "http://localhost:3811/"

```

```yaml
- navigation:
  - button "previous" [disabled]:
    - img "previous"
  - text: 1/ 1
  - button "next" [disabled]:
    - img "next"
- img
- text: Next.js 16.3.4 Webpack
- dialog "Runtime SyntaxError":
  - text: Runtime SyntaxError
  - button "Copy Error Info":
    - img
  - button "No related documentation found" [disabled]:
    - img
  - button "Attach Node.js inspector":
    - img
  - text: Unexpected end of JSON input
  - paragraph: Call Stack 20
  - button "Show 19 ignore-listed frame(s)":
    - text: Show 19 ignore-listed frame(s)
    - img
  - text: JSON.parse <anonymous>
- contentinfo:
  - region "Error feedback":
    - paragraph:
      - link "Was this helpful?":
        - /url: https://nextjs.org/telemetry#error-feedback
    - button "Mark as helpful"
    - button "Mark as not helpful"
- button "Open Next.js Dev Tools":
  - img
- button "Open issues overlay": 1 Issue
- button "Collapse issues badge":
  - img
- alert
```

# Test source

```ts
  1   | import { expect, test, type Locator, type Page } from "@playwright/test";
  2   | 
  3   | async function installNativeDetectionDouble(page: Page): Promise<void> {
  4   |   await page.addInitScript(() => {
  5   |     // Capacitor core replaces the initial detection methods when plugins load.
  6   |     // Its custom-platform input keeps this browser double stable across that load.
  7   |     Object.defineProperty(window, "CapacitorCustomPlatform", {
  8   |       configurable: true,
  9   |       value: { name: "ios" },
  10  |     });
  11  |     Object.defineProperty(window, "Capacitor", {
  12  |       configurable: true,
  13  |       value: { isNativePlatform: () => true, getPlatform: () => "ios" },
  14  |     });
  15  |   });
  16  | }
  17  | 
  18  | async function expectReachable(page: Page, action: Locator): Promise<void> {
  19  |   await expect(action).toBeInViewport({ ratio: 1 });
  20  |   const box = await action.boundingBox();
  21  |   expect(box).not.toBeNull();
  22  |   expect(box!.height).toBeGreaterThanOrEqual(44);
  23  |   expect(box!.width).toBeGreaterThanOrEqual(44);
  24  |   const hit = await action.evaluate((button) => {
  25  |     const box = button.getBoundingClientRect();
  26  |     const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  27  |     return { owned: button.contains(target), button: button.textContent, target: target?.outerHTML.slice(0, 300) };
  28  |   });
  29  |   expect(hit.owned, JSON.stringify(hit)).toBe(true);
  30  |   expect(await page.evaluate(() => document.documentElement.scrollWidth))
  31  |     .toBeLessThanOrEqual(page.viewportSize()!.width);
  32  | }
  33  | 
  34  | for (const viewport of [
  35  |   { width: 320, height: 568 },
  36  |   { width: 390, height: 844 },
  37  |   { width: 430, height: 932 },
  38  | ]) {
  39  |   for (const colorScheme of ["light", "dark"] as const) {
  40  |     test(`clean onboarding actions stay reachable at ${viewport.width}x${viewport.height} in ${colorScheme}`, async ({ page }, testInfo) => {
  41  |       await page.setViewportSize(viewport);
  42  |       await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  43  |       await installNativeDetectionDouble(page);
  44  |       await page.goto("/");
> 45  |       await expect(page).toHaveURL(/\/onboarding$/);
      |                          ^ Error: expect(page).toHaveURL(expected) failed
  46  |       await expect(page.getByRole("heading", { name: "London is ready." })).toBeVisible();
  47  |       await expect(page.locator(".analyticsConsentPrompt")).toHaveCount(0);
  48  | 
  49  |       const london = page.getByRole("button", { name: "Use London" });
  50  |       expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  51  |       await testInfo.attach("london-browser-initial", { body: await page.screenshot({ path: testInfo.outputPath("london-browser-initial.png") }), contentType: "image/png" });
  52  |       await expectReachable(page, london);
  53  |       await london.click();
  54  |       await expect(page.getByRole("heading", { name: "Pick your Pub Pal." })).toBeVisible();
  55  | 
  56  |       const plan = page.getByRole("button", { name: "Plan my night" });
  57  |       expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  58  |       await testInfo.attach("companion-browser-initial", { body: await page.screenshot({ path: testInfo.outputPath("companion-browser-initial.png") }), contentType: "image/png" });
  59  |       await expectReachable(page, plan);
  60  |       await page.getByRole("button", { name: /Black Cat/ }).click();
  61  |       await expectReachable(page, plan);
  62  |       await testInfo.attach("companion-browser", { body: await page.screenshot({ path: testInfo.outputPath("companion-browser.png") }), contentType: "image/png" });
  63  | 
  64  |       const buttons = page.locator(".firstRunOnboarding button");
  65  |       await page.getByRole("button", { name: "Skip", exact: true }).focus();
  66  |       for (let index = 1; index < await buttons.count(); index += 1) {
  67  |         await page.keyboard.press("Tab");
  68  |         await expect(buttons.nth(index)).toBeFocused();
  69  |         await expectReachable(page, buttons.nth(index));
  70  |       }
  71  |       await page.locator(".firstRunOnboarding").evaluate((surface) => {
  72  |         surface.scrollTo(0, surface.scrollHeight);
  73  |       });
  74  |       await expect(page.locator(".firstRunPermissionNote")).toBeInViewport({ ratio: 1 });
  75  |       await page.getByRole("button", { name: "Back", exact: true }).click();
  76  |       await expectReachable(page, london);
  77  | 
  78  |       const lastArea = page.getByText("Piccadilly & Soho", { exact: true });
  79  |       await page.locator(".firstRunOnboarding").evaluate((surface) => {
  80  |         surface.scrollTo(0, surface.scrollHeight);
  81  |       });
  82  |       await expect(lastArea).toBeInViewport({ ratio: 1 });
  83  |       const areaBox = await lastArea.boundingBox();
  84  |       const actionBox = await london.boundingBox();
  85  |       expect(areaBox!.y + areaBox!.height).toBeLessThanOrEqual(actionBox!.y);
  86  |       await expectReachable(page, london);
  87  |     });
  88  |   }
  89  | 
  90  |   test(`onboarding actions survive consent dismissal at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  91  |     await page.setViewportSize(viewport);
  92  |     await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  93  |     await installNativeDetectionDouble(page);
  94  |     await page.addInitScript(() => {
  95  |       // Seed the answer only for consent geometry, as ux-consent-chrome.spec.ts does.
  96  |       localStorage.removeItem("pubmaxx:analytics-consent:v1");
  97  |       sessionStorage.setItem("pubmax:consent-answer-moment:v1", "venue-sheet");
  98  |     });
  99  |     await page.goto("/");
  100 |     await expect(page).toHaveURL(/\/onboarding$/);
  101 |     const consent = page.getByLabel("Anonymous analytics choice");
  102 |     await expect(consent).toBeVisible();
  103 |     const london = page.getByRole("button", { name: "Use London" });
  104 |     expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  105 |     await expectReachable(page, london);
  106 |     await london.click();
  107 |     const plan = page.getByRole("button", { name: "Plan my night" });
  108 |     await expectReachable(page, plan);
  109 |     await consent.getByRole("button", { name: "No thanks" }).click();
  110 |     await expect(consent).toBeHidden();
  111 |     await expectReachable(page, plan);
  112 |     await page.getByRole("button", { name: "Back", exact: true }).click();
  113 |     await expectReachable(page, london);
  114 |   });
  115 | }
  116 | 
```