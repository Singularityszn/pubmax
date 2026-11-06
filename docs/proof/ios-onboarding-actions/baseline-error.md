# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-onboarding-actions.spec.ts >> clean onboarding actions stay reachable at 390x844 in light
- Location: e2e/native-onboarding-actions.spec.ts:26:9

# Error details

```
Error: expect(locator).toBeInViewport() failed

Locator:  getByRole('button', { name: 'Plan my night' })
Expected: in viewport
Received: viewport ratio 0.5103124976158142
Timeout:  10000ms

Call log:
  - Expect "toBeInViewport" with timeout 10000ms
  - waiting for getByRole('button', { name: 'Plan my night' })
    24 × locator resolved to <button type="button" class="firstRunPrimary pressable">…</button>
       - unexpected value "viewport ratio 0.5103124976158142"

```

```yaml
- button "Plan my night"
```

# Test source

```ts
  1   | import { expect, test, type Locator, type Page } from "@playwright/test";
  2   | 
  3   | async function expectReachable(page: Page, action: Locator): Promise<void> {
> 4   |   await expect(action).toBeInViewport({ ratio: 1 });
      |                        ^ Error: expect(locator).toBeInViewport() failed
  5   |   const box = await action.boundingBox();
  6   |   expect(box).not.toBeNull();
  7   |   expect(box!.height).toBeGreaterThanOrEqual(44);
  8   |   expect(box!.width).toBeGreaterThanOrEqual(44);
  9   |   expect(await action.evaluate((button) => {
  10  |     const box = button.getBoundingClientRect();
  11  |     return button.contains(document.elementFromPoint(
  12  |       box.x + box.width / 2,
  13  |       box.y + box.height / 2,
  14  |     ));
  15  |   })).toBe(true);
  16  |   expect(await page.evaluate(() => document.documentElement.scrollWidth))
  17  |     .toBeLessThanOrEqual(page.viewportSize()!.width);
  18  | }
  19  | 
  20  | for (const viewport of [
  21  |   { width: 320, height: 568 },
  22  |   { width: 390, height: 844 },
  23  |   { width: 430, height: 932 },
  24  | ]) {
  25  |   for (const colorScheme of ["light", "dark"] as const) {
  26  |     test(`clean onboarding actions stay reachable at ${viewport.width}x${viewport.height} in ${colorScheme}`, async ({ page }, testInfo) => {
  27  |       await page.setViewportSize(viewport);
  28  |       await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  29  |       await page.addInitScript(() => {
  30  |         Object.defineProperty(window, "Capacitor", {
  31  |           configurable: true,
  32  |           value: { isNativePlatform: () => true, getPlatform: () => "ios" },
  33  |         });
  34  |       });
  35  |       await page.goto("/");
  36  |       await expect(page).toHaveURL(/\/onboarding$/);
  37  |       await expect(page.getByRole("heading", { name: "London is ready." })).toBeVisible();
  38  |       await expect(page.locator(".analyticsConsentPrompt")).toHaveCount(0);
  39  | 
  40  |       const london = page.getByRole("button", { name: "Use London" });
  41  |       expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  42  |       await expectReachable(page, london);
  43  |       await testInfo.attach("london-browser", { body: await page.screenshot(), contentType: "image/png" });
  44  |       await london.click();
  45  |       await expect(page.getByRole("heading", { name: "Pick your Pub Pal." })).toBeVisible();
  46  | 
  47  |       const plan = page.getByRole("button", { name: "Plan my night" });
  48  |       expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  49  |       await expectReachable(page, plan);
  50  |       await page.getByRole("button", { name: /Black Cat/ }).click();
  51  |       await expectReachable(page, plan);
  52  |       await testInfo.attach("companion-browser", { body: await page.screenshot(), contentType: "image/png" });
  53  | 
  54  |       const buttons = page.locator(".firstRunOnboarding button");
  55  |       await page.getByRole("button", { name: "Skip", exact: true }).focus();
  56  |       for (let index = 1; index < await buttons.count(); index += 1) {
  57  |         await page.keyboard.press("Tab");
  58  |         await expect(buttons.nth(index)).toBeFocused();
  59  |         await expectReachable(page, buttons.nth(index));
  60  |       }
  61  |       await page.locator(".firstRunOnboarding").evaluate((surface) => {
  62  |         surface.scrollTo(0, surface.scrollHeight);
  63  |       });
  64  |       await expect(page.locator(".firstRunPermissionNote")).toBeInViewport({ ratio: 1 });
  65  |       await page.getByRole("button", { name: "Back", exact: true }).click();
  66  |       await expectReachable(page, london);
  67  | 
  68  |       const lastArea = page.getByText("Piccadilly & Soho", { exact: true });
  69  |       await page.locator(".firstRunOnboarding").evaluate((surface) => {
  70  |         surface.scrollTo(0, surface.scrollHeight);
  71  |       });
  72  |       await expect(lastArea).toBeInViewport({ ratio: 1 });
  73  |       const areaBox = await lastArea.boundingBox();
  74  |       const actionBox = await london.boundingBox();
  75  |       expect(areaBox!.y + areaBox!.height).toBeLessThanOrEqual(actionBox!.y);
  76  |       await expectReachable(page, london);
  77  |     });
  78  |   }
  79  | 
  80  |   test(`onboarding actions survive consent dismissal at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  81  |     await page.setViewportSize(viewport);
  82  |     await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  83  |     await page.addInitScript(() => {
  84  |       Object.defineProperty(window, "Capacitor", {
  85  |         configurable: true,
  86  |         value: { isNativePlatform: () => true, getPlatform: () => "ios" },
  87  |       });
  88  |       // Seed the answer only for consent geometry, as ux-consent-chrome.spec.ts does.
  89  |       localStorage.removeItem("pubmaxx:analytics-consent:v1");
  90  |       sessionStorage.setItem("pubmax:consent-answer-moment:v1", "venue-sheet");
  91  |     });
  92  |     await page.goto("/");
  93  |     await expect(page).toHaveURL(/\/onboarding$/);
  94  |     const consent = page.getByLabel("Anonymous analytics choice");
  95  |     await expect(consent).toBeVisible();
  96  |     const london = page.getByRole("button", { name: "Use London" });
  97  |     expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  98  |     await expectReachable(page, london);
  99  |     await london.click();
  100 |     const plan = page.getByRole("button", { name: "Plan my night" });
  101 |     await expectReachable(page, plan);
  102 |     await consent.getByRole("button", { name: "No thanks" }).click();
  103 |     await expect(consent).toBeHidden();
  104 |     await expectReachable(page, plan);
```