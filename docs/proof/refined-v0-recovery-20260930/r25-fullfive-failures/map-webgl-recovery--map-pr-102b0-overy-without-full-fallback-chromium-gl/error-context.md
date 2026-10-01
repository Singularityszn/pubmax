# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-webgl-recovery.spec.ts >> /map preventDefaults webglcontextlost and arms recovery without full fallback
- Location: e2e/map-webgl-recovery.spec.ts:18:5

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.getAttribute: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('.maplibreMap')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to main content" [ref=e2] [cursor=pointer]:
    - /url: "#main"
  - main [ref=e3]:
    - region "Interactive pub map of London" [ref=e4]:
      - alert [ref=e6]:
        - strong [ref=e7]: Map tiles unavailable
        - paragraph [ref=e8]: The map loaded tiles but couldn't finish drawing pubs. The pub list and crawl planner beside it still work as ever.
        - button "Technical details" [ref=e10] [cursor=pointer]
        - list "Pubs you can still browse" [ref=e11]:
          - listitem [ref=e12]:
            - button "The Kentish Drovers Southwark · £1.99" [ref=e13] [cursor=pointer]:
              - generic [ref=e14]: The Kentish Drovers
              - generic [ref=e15]: Southwark · £1.99
          - listitem [ref=e16]:
            - button "The Fox on the Hill Southwark · £1.99" [ref=e17] [cursor=pointer]:
              - generic [ref=e18]: The Fox on the Hill
              - generic [ref=e19]: Southwark · £1.99
          - listitem [ref=e20]:
            - button "The Rochester Castle Hackney · £1.99" [ref=e21] [cursor=pointer]:
              - generic [ref=e22]: The Rochester Castle
              - generic [ref=e23]: Hackney · £1.99
          - listitem [ref=e24]:
            - button "J.J. Moons Wandsworth · £2.09" [ref=e25] [cursor=pointer]:
              - generic [ref=e26]: J.J. Moons
              - generic [ref=e27]: Wandsworth · £2.09
          - listitem [ref=e28]:
            - button "J.J. Moon's - JD Wetherspoon Wandsworth · £2.43" [ref=e29] [cursor=pointer]:
              - generic [ref=e30]: J.J. Moon's - JD Wetherspoon
              - generic [ref=e31]: Wandsworth · £2.43
          - listitem [ref=e32]:
            - button "The Rockingham Arms Southwark · £2.49" [ref=e33] [cursor=pointer]:
              - generic [ref=e34]: The Rockingham Arms
              - generic [ref=e35]: Southwark · £2.49
        - link "Browse all pubs" [ref=e36] [cursor=pointer]:
          - /url: /pubs
        - button "Retry" [ref=e37] [cursor=pointer]
      - generic "Map controls":
        - generic [ref=e38]:
          - link "Open PUBMAXX landing page" [ref=e39] [cursor=pointer]:
            - /url: /
            - img "PUBMAXX" [ref=e40]:
              - generic [ref=e42]:
                - generic [ref=e43]: PUBMAX
                - generic [ref=e44]: X
          - 'button "Map area: London. Change city" [ref=e46] [cursor=pointer]':
            - generic [ref=e47]: London
          - button "Search the map" [ref=e49] [cursor=pointer]
          - button "Filters" [ref=e53] [cursor=pointer]
          - button "More map controls" [ref=e55] [cursor=pointer]
        - 'button "Drink shown on the map: Pints. Choose another drink" [ref=e61] [cursor=pointer]':
          - generic [ref=e65]: Pints
      - generic "Map utilities":
        - 'button "TfL live: 8 updates" [ref=e66] [cursor=pointer]':
          - generic [ref=e74]: "8"
        - button "Near me" [ref=e75] [cursor=pointer]
      - button "Describe the outing" [ref=e79] [cursor=pointer]:
        - strong [ref=e85]: Describe the outing
  - navigation "Primary":
    - list [ref=e86]:
      - listitem
      - listitem [ref=e87]:
        - link "Tonight" [ref=e88] [cursor=pointer]:
          - /url: /tonight
      - listitem [ref=e96]:
        - link "Map" [ref=e97] [cursor=pointer]:
          - /url: /map
      - listitem [ref=e103]:
        - link "Places" [ref=e104] [cursor=pointer]:
          - /url: /places
      - listitem [ref=e110]:
        - link "Out" [ref=e111] [cursor=pointer]:
          - /url: /out
      - listitem [ref=e118]:
        - link "Plan" [ref=e119] [cursor=pointer]:
          - /url: /plan
      - listitem [ref=e127]:
        - link "You" [ref=e128] [cursor=pointer]:
          - /url: /u/you
  - button "Create" [ref=e135] [cursor=pointer]
  - alert [ref=e137]
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | // Synthetic WebGL context-loss recovery. Real iOS backgrounding is not
  4   | // lab-reachable; this proves the canvas module (a) preventDefaults the DOM
  5   | // event so the browser may restore, (b) marks recovery state on the map
  6   | // container, and (c) never replaces a painted map with silent grey.
  7   | 
  8   | test.describe.configure({ mode: "serial" });
  9   | 
  10  | test.beforeEach(async ({ page }) => {
  11  |   await page.addInitScript(() => {
  12  |     window.localStorage.setItem("pubmax-tour-v1-done", "1");
  13  |     window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  14  |     window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
  15  |   });
  16  | });
  17  | 
  18  | test("/map preventDefaults webglcontextlost and arms recovery without full fallback", async ({
  19  |   page,
  20  | }) => {
  21  |   test.setTimeout(60_000);
  22  |   await page.setViewportSize({ width: 390, height: 844 });
  23  |   const response = await page.goto("/map");
  24  |   expect(response?.status()).toBe(200);
  25  | 
  26  |   const canvas = page.locator(".maplibreMap canvas").first();
  27  |   await expect(canvas).toBeVisible({ timeout: 25_000 });
  28  |   // Wait for recovery wiring (style load + construct listeners).
  29  |   await expect
  30  |     .poll(
  31  |       async () =>
  32  |         page.locator(".maplibreMap").getAttribute("data-webgl-recovery"),
  33  |       { timeout: 30_000 },
  34  |     )
  35  |     .toBe("listening");
  36  | 
  37  |   const result = await page.evaluate(() => {
  38  |     const el = document.querySelector(".maplibreMap canvas");
  39  |     if (!el) return { ok: false, reason: "no-canvas" as const };
  40  |     const event = new Event("webglcontextlost", {
  41  |       cancelable: true,
  42  |       bubbles: true,
  43  |     });
  44  |     el.dispatchEvent(event);
  45  |     const recovery = document
  46  |       .querySelector(".maplibreMap")
  47  |       ?.getAttribute("data-webgl-recovery");
  48  |     return {
  49  |       ok: true as const,
  50  |       defaultPrevented: event.defaultPrevented,
  51  |       recovery,
  52  |     };
  53  |   });
  54  | 
  55  |   expect(result.ok).toBe(true);
  56  |   if (result.ok) {
  57  |     // (a) preventDefault so the browser is allowed to restore the context.
  58  |     expect(result.defaultPrevented).toBe(true);
  59  |     // Recovery schedule is armed immediately.
  60  |     expect(result.recovery).toBe("recovering");
  61  |   }
  62  | 
  63  |   // Canvas stays mounted — no silent unmount / full-fallback swap on a
  64  |   // synthetic loss that the browser can still restore.
  65  |   await expect(canvas).toBeVisible();
  66  |   await expect(page.locator(".mapFallback")).toHaveCount(0);
  67  | 
  68  |   // After the grace window, a healthy lab context repaints (not soft-retry).
  69  |   // Lab GL stacks almost never actually lose context from a synthetic event,
  70  |   // so the health check sees a live gl and settles on restored/repaint.
  71  |   await page.waitForTimeout(1200);
  72  |   const after = await page
  73  |     .locator(".maplibreMap")
> 74  |     .getAttribute("data-webgl-recovery");
      |      ^ Error: locator.getAttribute: Test timeout of 60000ms exceeded.
  75  |   expect(["restored", "recovering", "reinit", "listening", "soft-retry"]).toContain(
  76  |     after,
  77  |   );
  78  |   await expect(page.locator(".mapFallback")).toHaveCount(0);
  79  |   await expect(canvas).toBeVisible();
  80  | });
  81  | 
  82  | test("/map dispatches webglcontextrestored → recovery marker and live canvas", async ({
  83  |   page,
  84  | }) => {
  85  |   test.setTimeout(45_000);
  86  |   await page.setViewportSize({ width: 390, height: 844 });
  87  |   await page.goto("/map");
  88  |   const canvas = page.locator(".maplibreMap canvas").first();
  89  |   await expect(canvas).toBeVisible({ timeout: 25_000 });
  90  |   await expect
  91  |     .poll(
  92  |       async () =>
  93  |         page.locator(".maplibreMap").getAttribute("data-webgl-recovery"),
  94  |       { timeout: 30_000 },
  95  |     )
  96  |     .toBe("listening");
  97  | 
  98  |   await page.evaluate(() => {
  99  |     const el = document.querySelector(".maplibreMap canvas");
  100 |     if (!el) return;
  101 |     el.dispatchEvent(
  102 |       new Event("webglcontextlost", { cancelable: true, bubbles: true }),
  103 |     );
  104 |     el.dispatchEvent(
  105 |       new Event("webglcontextrestored", { cancelable: true, bubbles: true }),
  106 |     );
  107 |   });
  108 | 
  109 |   await expect
  110 |     .poll(
  111 |       async () =>
  112 |         page.locator(".maplibreMap").getAttribute("data-webgl-recovery"),
  113 |       { timeout: 5_000 },
  114 |     )
  115 |     .toBe("restored");
  116 | 
  117 |   await expect(canvas).toBeVisible();
  118 |   await expect(page.locator(".mapFallback")).toHaveCount(0);
  119 | });
  120 | 
```