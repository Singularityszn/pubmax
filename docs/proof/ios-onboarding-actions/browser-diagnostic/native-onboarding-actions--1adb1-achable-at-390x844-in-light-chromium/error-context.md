# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: native-onboarding-actions.spec.ts >> clean onboarding actions stay reachable at 390x844 in light
- Location: e2e/native-onboarding-actions.spec.ts:40:9

# Error details

```
Error: {"owned":false,"button":" Back","target":"<nextjs-portal style=\"--nextjs-dev-tools-scale: 1;\"></nextjs-portal>"}

expect(received).toBe(expected) // Object.is equality

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
  24  |   const hit = await action.evaluate((button) => {
  25  |     const box = button.getBoundingClientRect();
  26  |     const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  27  |     return { owned: button.contains(target), button: button.textContent, target: target?.outerHTML.slice(0, 300) };
  28  |   });
> 29  |   expect(hit.owned, JSON.stringify(hit)).toBe(true);
      |                                          ^ Error: {"owned":false,"button":" Back","target":"<nextjs-portal style=\"--nextjs-dev-tools-scale: 1;\"></nextjs-portal>"}
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
  45  |       await expect(page).toHaveURL(/\/onboarding$/);
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