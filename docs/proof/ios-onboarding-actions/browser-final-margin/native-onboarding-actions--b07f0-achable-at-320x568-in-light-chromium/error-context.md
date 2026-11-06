# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-onboarding-actions.spec.ts >> clean onboarding actions stay reachable at 320x568 in light
- Location: e2e/native-onboarding-actions.spec.ts:41:9

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - link "Skip to main content" [ref=e2] [cursor=pointer]:
    - /url: "#main"
  - main [ref=e3]:
    - generic [ref=e4]:
      - generic "PUBMAXXING" [ref=e5]
      - progressbar "Onboarding progress" [ref=e6]
      - button "Skip" [ref=e9] [cursor=pointer]
    - generic [ref=e10]:
      - region "Companion preview" [ref=e11]:
        - generic [ref=e12]:
          - img "Pub Pal" [ref=e17]
          - paragraph [ref=e21]: Black Cat will be in your corner for the first night.
      - generic [ref=e23]:
        - paragraph [ref=e24]: Your companion
        - heading "Pick your Pub Pal." [level=1] [ref=e25]
        - paragraph [ref=e26]: Every Pal reads the same real prices and routes. Pick the one you want in your corner tonight.
        - group "Choose your Pub Pal" [ref=e27]:
          - button "Circuit Robin Bright and grounded" [ref=e28] [cursor=pointer]:
            - generic [ref=e29]: Circuit Robin
            - generic [ref=e30]: Bright and grounded
          - button "Greyhound Loyal and perceptive" [ref=e31] [cursor=pointer]:
            - generic [ref=e32]: Greyhound
            - generic [ref=e33]: Loyal and perceptive
          - button "Black Cat Calm and mischievous" [pressed] [ref=e34] [cursor=pointer]:
            - generic [ref=e35]: Black Cat
            - generic [ref=e36]: Calm and mischievous
          - button "Fox Curious and quick" [ref=e39] [cursor=pointer]:
            - generic [ref=e40]: Fox
            - generic [ref=e41]: Curious and quick
          - button "Pigeon Streetwise and social" [ref=e42] [cursor=pointer]:
            - generic [ref=e43]: Pigeon
            - generic [ref=e44]: Streetwise and social
          - button "Badger Steady and protective" [ref=e45] [cursor=pointer]:
            - generic [ref=e46]: Badger
            - generic [ref=e47]: Steady and protective
          - button "Corgi Bright and encouraging" [ref=e48] [cursor=pointer]:
            - generic [ref=e49]: Corgi
            - generic [ref=e50]: Bright and encouraging
        - paragraph [ref=e51]: You can name, tweak, or skip your Pal later.
        - generic [ref=e55]:
          - button "Back" [active] [ref=e56] [cursor=pointer]
          - button "Plan my night" [ref=e59] [cursor=pointer]
        - paragraph [ref=e62]: We won’t ask about notifications until your first night’s sorted.
  - button "Open Next.js Dev Tools" [ref=e68] [cursor=pointer]:
    - generic [ref=e71]:
      - text: Compiling
      - generic [ref=e72]:
        - generic [ref=e73]: .
        - generic [ref=e74]: .
        - generic [ref=e75]: .
  - alert [ref=e76]
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
  24  |   expect(await action.evaluate((button) => {
  25  |     const box = button.getBoundingClientRect();
  26  |     return button.contains(document.elementFromPoint(
  27  |       box.x + box.width / 2,
  28  |       box.y + box.height / 2,
  29  |     ));
> 30  |   })).toBe(true);
      |       ^ Error: expect(received).toBe(expected) // Object.is equality
  31  |   expect(await page.evaluate(() => document.documentElement.scrollWidth))
  32  |     .toBeLessThanOrEqual(page.viewportSize()!.width);
  33  | }
  34  | 
  35  | for (const viewport of [
  36  |   { width: 320, height: 568 },
  37  |   { width: 390, height: 844 },
  38  |   { width: 430, height: 932 },
  39  | ]) {
  40  |   for (const colorScheme of ["light", "dark"] as const) {
  41  |     test(`clean onboarding actions stay reachable at ${viewport.width}x${viewport.height} in ${colorScheme}`, async ({ page }, testInfo) => {
  42  |       await page.setViewportSize(viewport);
  43  |       await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  44  |       await installNativeDetectionDouble(page);
  45  |       await page.goto("/");
  46  |       await expect(page).toHaveURL(/\/onboarding$/);
  47  |       await expect(page.getByRole("heading", { name: "London is ready." })).toBeVisible();
  48  |       await expect(page.locator(".analyticsConsentPrompt")).toHaveCount(0);
  49  | 
  50  |       const london = page.getByRole("button", { name: "Use London" });
  51  |       expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  52  |       await testInfo.attach("london-browser-initial", { body: await page.screenshot({ path: testInfo.outputPath("london-browser-initial.png") }), contentType: "image/png" });
  53  |       await expectReachable(page, london);
  54  |       await london.click();
  55  |       await expect(page.getByRole("heading", { name: "Pick your Pub Pal." })).toBeVisible();
  56  | 
  57  |       const plan = page.getByRole("button", { name: "Plan my night" });
  58  |       expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  59  |       await testInfo.attach("companion-browser-initial", { body: await page.screenshot({ path: testInfo.outputPath("companion-browser-initial.png") }), contentType: "image/png" });
  60  |       await expectReachable(page, plan);
  61  |       await page.getByRole("button", { name: /Black Cat/ }).click();
  62  |       await expectReachable(page, plan);
  63  |       await testInfo.attach("companion-browser", { body: await page.screenshot({ path: testInfo.outputPath("companion-browser.png") }), contentType: "image/png" });
  64  | 
  65  |       const buttons = page.locator(".firstRunOnboarding button");
  66  |       await page.getByRole("button", { name: "Skip", exact: true }).focus();
  67  |       for (let index = 1; index < await buttons.count(); index += 1) {
  68  |         await page.keyboard.press("Tab");
  69  |         await expect(buttons.nth(index)).toBeFocused();
  70  |         await expectReachable(page, buttons.nth(index));
  71  |       }
  72  |       await page.locator(".firstRunOnboarding").evaluate((surface) => {
  73  |         surface.scrollTo(0, surface.scrollHeight);
  74  |       });
  75  |       await expect(page.locator(".firstRunPermissionNote")).toBeInViewport({ ratio: 1 });
  76  |       await page.getByRole("button", { name: "Back", exact: true }).click();
  77  |       await expectReachable(page, london);
  78  | 
  79  |       const lastArea = page.getByText("Piccadilly & Soho", { exact: true });
  80  |       await page.locator(".firstRunOnboarding").evaluate((surface) => {
  81  |         surface.scrollTo(0, surface.scrollHeight);
  82  |       });
  83  |       await expect(lastArea).toBeInViewport({ ratio: 1 });
  84  |       const areaBox = await lastArea.boundingBox();
  85  |       const actionBox = await london.boundingBox();
  86  |       expect(areaBox!.y + areaBox!.height).toBeLessThanOrEqual(actionBox!.y);
  87  |       await expectReachable(page, london);
  88  |     });
  89  |   }
  90  | 
  91  |   test(`onboarding actions survive consent dismissal at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  92  |     await page.setViewportSize(viewport);
  93  |     await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  94  |     await installNativeDetectionDouble(page);
  95  |     await page.addInitScript(() => {
  96  |       // Seed the answer only for consent geometry, as ux-consent-chrome.spec.ts does.
  97  |       localStorage.removeItem("pubmaxx:analytics-consent:v1");
  98  |       sessionStorage.setItem("pubmax:consent-answer-moment:v1", "venue-sheet");
  99  |     });
  100 |     await page.goto("/");
  101 |     await expect(page).toHaveURL(/\/onboarding$/);
  102 |     const consent = page.getByLabel("Anonymous analytics choice");
  103 |     await expect(consent).toBeVisible();
  104 |     const london = page.getByRole("button", { name: "Use London" });
  105 |     expect(await page.locator(".firstRunOnboarding").evaluate((surface) => surface.scrollTop)).toBe(0);
  106 |     await expectReachable(page, london);
  107 |     await london.click();
  108 |     const plan = page.getByRole("button", { name: "Plan my night" });
  109 |     await expectReachable(page, plan);
  110 |     await consent.getByRole("button", { name: "No thanks" }).click();
  111 |     await expect(consent).toBeHidden();
  112 |     await expectReachable(page, plan);
  113 |     await page.getByRole("button", { name: "Back", exact: true }).click();
  114 |     await expectReachable(page, london);
  115 |   });
  116 | }
  117 | 
```