# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: price-intent-lifecycle.spec.ts >> a consumed price intent retires on Home and Create starts another contribution
- Location: ../../../../../../private/tmp/pubmaxx-r46-native-journal/price-intent-lifecycle.spec.ts:37:5

# Error details

```
Error: expect(received).toBeNull()

Received: "price"

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - link "Skip to main content" [ref=f1e2] [cursor=pointer]:
    - /url: "#main"
  - main [ref=f1e3]:
    - region "Interactive pub map of Manchester" [ref=f1e4]:
      - generic [ref=f1e6]:
        - region "Map" [ref=f1e7]
        - group [ref=f1e8]:
          - generic "Toggle attribution" [ref=f1e9] [cursor=pointer]
      - generic "Map controls":
        - generic [ref=f1e10]:
          - link "Open PUBMAXX landing page" [ref=f1e11] [cursor=pointer]:
            - /url: /
            - img "PUBMAXX" [ref=f1e12]:
              - generic [ref=f1e14]:
                - generic [ref=f1e15]: PUBMAX
                - generic [ref=f1e16]: X
          - 'button "Map area: Manchester. Change city" [ref=f1e18] [cursor=pointer]':
            - generic [ref=f1e19]: Manchester
          - button "Search the map" [ref=f1e21] [cursor=pointer]
          - 'button "Filters: drinks active" [ref=f1e25] [cursor=pointer]':
            - generic [ref=f1e27]: "1"
          - button "More map controls" [ref=f1e28] [cursor=pointer]
        - 'button "Drink shown on the map: Wine. Choose another drink" [ref=f1e34] [cursor=pointer]':
          - generic [ref=f1e38]: Wine
      - generic "Map utilities":
        - button "Near me" [ref=f1e39] [cursor=pointer]
  - navigation "Primary":
    - list [ref=f1e43]:
      - listitem
      - listitem [ref=f1e44]:
        - link "Tonight" [ref=f1e45] [cursor=pointer]:
          - /url: /tonight
      - listitem [ref=f1e53]:
        - link "Map" [ref=f1e54] [cursor=pointer]:
          - /url: /map/manchester
      - listitem [ref=f1e60]:
        - link "Places" [ref=f1e61] [cursor=pointer]:
          - /url: /places
      - listitem [ref=f1e67]:
        - link "Out" [ref=f1e68] [cursor=pointer]:
          - /url: /out
      - listitem [ref=f1e75]:
        - link "Plan" [ref=f1e76] [cursor=pointer]:
          - /url: /plan
      - listitem [ref=f1e84]:
        - link "You" [ref=f1e85] [cursor=pointer]:
          - /url: /u/karan
  - button "Create" [ref=f1e92] [cursor=pointer]
  - alert [ref=f1e94]
  - generic:
    - button "Dismiss Choose a pub backdrop" [ref=f1e95] [cursor=pointer]
    - dialog [active] [ref=f1e96]:
      - banner [ref=f1e97]:
        - button "Collapse sheet" [ref=f1e98] [cursor=pointer]
        - heading "Choose a pub" [level=2] [ref=f1e100]
        - button "Close Choose a pub" [ref=f1e101] [cursor=pointer]
      - status [ref=f1e106]:
        - generic [ref=f1e107]:
          - strong [ref=f1e109]: Pick a pub to log a price
          - paragraph [ref=f1e110]: Nearest pubs to the map centre. Choose one, search, or tap the map. Then we’ll open the price form.
        - list "Pubs near the map centre" [ref=f1e111]:
          - listitem [ref=f1e112]:
            - button "Northern Bar 30 m Wine price unknown" [ref=f1e113] [cursor=pointer]:
              - generic [ref=f1e114]: Northern Bar
              - generic [ref=f1e115]:
                - generic [ref=f1e116]: 30 m
                - generic [ref=f1e117]: Wine price unknown
          - listitem [ref=f1e118]:
            - button "The Lass O'Gowrie 124 m Wine price unknown" [ref=f1e119] [cursor=pointer]:
              - generic [ref=f1e120]: The Lass O'Gowrie
              - generic [ref=f1e121]:
                - generic [ref=f1e122]: 124 m
                - generic [ref=f1e123]: Wine price unknown
          - listitem [ref=f1e124]:
            - button "O'Connell's 202 m Wine price unknown" [ref=f1e125] [cursor=pointer]:
              - generic [ref=f1e126]: O'Connell's
              - generic [ref=f1e127]:
                - generic [ref=f1e128]: 202 m
                - generic [ref=f1e129]: Wine price unknown
          - listitem [ref=f1e130]:
            - button "The Garratt 207 m Wine price unknown" [ref=f1e131] [cursor=pointer]:
              - generic [ref=f1e132]: The Garratt
              - generic [ref=f1e133]:
                - generic [ref=f1e134]: 207 m
                - generic [ref=f1e135]: Wine price unknown
          - listitem [ref=f1e136]:
            - button "Grand Central 213 m Wine price unknown" [ref=f1e137] [cursor=pointer]:
              - generic [ref=f1e138]: Grand Central
              - generic [ref=f1e139]:
                - generic [ref=f1e140]: 213 m
                - generic [ref=f1e141]: Wine price unknown
        - button "Search pubs" [ref=f1e143] [cursor=pointer]
```

# Test source

```ts
  1   | import { writeFileSync } from "node:fs";
  2   | import { expect, test, type Page } from "/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/node_modules/@playwright/test";
  3   | 
  4   | import { installAuthDoubles, seedSignedIn } from "/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/e2e/helpers/authDoubles";
  5   | import { installDeterministicMapBasemap } from "/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/e2e/helpers/mapNetworkFixtures";
  6   | 
  7   | test.use({ serviceWorkers: "block" });
  8   | test.setTimeout(90_000);
  9   | 
  10  | test.beforeEach(async ({ page }) => {
  11  |   await page.setViewportSize({ width: 390, height: 844 });
  12  |   await page.emulateMedia({ reducedMotion: "reduce" });
  13  |   await page.addInitScript(() => {
  14  |     localStorage.setItem("pubmax-tour-v1-done", "1");
  15  |     localStorage.setItem("pubmax_onboarding_dismissed", "1");
  16  |     localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  17  |     localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  18  |     sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  19  |     sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  20  |   });
  21  |   await installAuthDoubles(page);
  22  |   await installDeterministicMapBasemap(page);
  23  | });
  24  | 
  25  | const venueSheet = (page: Page) => page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  26  | const contributeParam = (page: Page) => new URL(page.url()).searchParams.get("contribute");
  27  | 
  28  | async function openCreateLogAPrice(page: Page) {
  29  |   await expect(async () => {
  30  |     await page.getByTestId("create-fab").click();
  31  |     await expect(page.locator(".createFabMenu").getByRole("link", { name: "Log a price" })).toBeVisible({ timeout: 1_000 });
  32  |   }).toPass({ timeout: 20_000 });
  33  |   await page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }).click();
  34  |   await expect(page.getByText("Pick a pub to log a price", { exact: true })).toBeVisible({ timeout: 45_000 });
  35  | }
  36  | 
  37  | test("a consumed price intent retires on Home and Create starts another contribution", async ({ page }) => {
  38  |   await seedSignedIn(page, "A");
  39  |   await page.goto("/map/manchester?drink=wine&contribute=price");
  40  |   await expect(page.locator(".logIntentNearbyBtn").first()).toBeVisible({ timeout: 45_000 });
  41  |   await page.locator(".logIntentNearbyBtn").first().click();
  42  |   const price = page.getByRole("textbox", { name: /Price of a wine at/ });
  43  |   await expect(price).toBeVisible();
  44  |   await expect.poll(() => contributeParam(page)).toBeNull();
  45  | 
  46  |   await venueSheet(page).locator(".surfaceNavHome").click();
  47  |   await expect(price).toBeHidden();
> 48  |   await expect.poll(() => contributeParam(page)).toBeNull();
      |                                                  ^ Error: expect(received).toBeNull()
  49  |   await expect(page.getByText(/Pick a pub to log a/)).toHaveCount(0);
  50  | 
  51  |   await openCreateLogAPrice(page);
  52  |   await page.locator(".logIntentNearbyBtn").first().click();
  53  |   await expect(price).toBeVisible();
  54  |   await expect.poll(() => contributeParam(page)).toBeNull();
  55  | });
  56  | 
  57  | test("an anonymous price intent stays with the first pub and never gates another", async ({ page }) => {
  58  |   await page.goto("/map/manchester?drink=wine");
  59  |   await openCreateLogAPrice(page);
  60  |   const nearby = page.locator(".logIntentNearbyBtn");
  61  |   await expect(nearby.nth(1)).toBeVisible();
  62  |   const otherVenue = (await nearby.nth(1).locator("span").first().textContent())?.trim();
  63  |   expect(otherVenue).toBeTruthy();
  64  |   await nearby.first().click();
  65  | 
  66  |   const gate = venueSheet(page).getByRole("heading", { name: "Sign in to add a price" });
  67  |   await expect(gate).toBeVisible();
  68  |   expect(contributeParam(page)).toBe("price");
  69  | 
  70  |   await venueSheet(page).locator(".surfaceNavHome").click();
  71  |   await expect(gate).toBeHidden();
  72  |   await page.getByRole("button", { name: "Search the map" }).click();
  73  |   await page.locator("#mobileMapSearchInput").fill(otherVenue!);
  74  |   await page.getByRole("option", { name: new RegExp(otherVenue!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  75  | 
  76  |   await expect(venueSheet(page)).toContainText(otherVenue!);
  77  |   await expect(page.getByRole("button", { name: "Log a wine price", exact: true })).toBeVisible();
  78  |   await expect(gate).toHaveCount(0);
  79  |   await expect.poll(() => contributeParam(page)).toBeNull();
  80  | });
  81  | 
  82  | test("an anonymous price intent retires when a client navigation opens another pub over the gate", async ({ page }) => {
  83  |   await page.goto("/map/manchester?drink=wine&contribute=price");
  84  |   const nearby = page.locator(".logIntentNearbyBtn");
  85  |   await expect(nearby.nth(1)).toBeVisible({ timeout: 45_000 });
  86  |   // Learn the second pub's id from its hover prefetch, refused so its detail
  87  |   // is not warm and the drawer reopens as a fresh inspector for it.
  88  |   const otherDetail = page.waitForRequest((request) => request.url().includes("/api/venue/"));
  89  |   await page.route("**/api/venue/**", (route) => route.abort());
  90  |   await nearby.nth(1).hover();
  91  |   const otherVenueId = decodeURIComponent(new URL((await otherDetail).url()).pathname.split("/").at(-1)!);
  92  |   await page.unroute("**/api/venue/**");
  93  |   await page.route(`**/api/venue/${encodeURIComponent(otherVenueId)}`, (route) => route.abort());
  94  |   await nearby.first().click();
  95  | 
  96  |   const gate = venueSheet(page).getByRole("heading", { name: "Sign in to add a price" });
  97  |   await expect(gate).toBeVisible();
  98  |   const gatedVenueId = new URL(page.url()).searchParams.get("sel");
  99  |   expect(gatedVenueId).toBeTruthy();
  100 |   expect(gatedVenueId).not.toBe(otherVenueId);
  101 |   expect(contributeParam(page)).toBe("price");
  102 | 
  103 |   await page.unroute(`**/api/venue/${encodeURIComponent(otherVenueId)}`);
  104 |   // The same client navigation a "See on map" link makes: the map stays
  105 |   // mounted, keeps the live URL's params and selects the linked pub.
  106 |   await page.evaluate((venueId) => {
  107 |     const url = new URL(window.location.href);
  108 |     url.searchParams.set("sel", venueId);
  109 |     (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(`${url.pathname}${url.search}`);
  110 |   }, otherVenueId);
  111 | 
  112 |   await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(otherVenueId);
  113 |   await expect(page.getByRole("button", { name: "Log a wine price", exact: true })).toBeVisible();
  114 |   await expect(gate).toHaveCount(0);
  115 |   await expect.poll(() => contributeParam(page)).toBeNull();
  116 | });
  117 | 
  118 | test("Back from a gated pub returns to the price picker, which still opens another pub's price door", async ({ page }) => {
  119 |   await page.goto("/map/manchester?drink=wine");
  120 |   await openCreateLogAPrice(page);
  121 |   const nearby = page.locator(".logIntentNearbyBtn");
  122 |   await expect(nearby.nth(1)).toBeVisible();
  123 |   const firstVenue = (await nearby.first().locator("span").first().textContent())?.trim();
  124 |   expect(firstVenue).toBeTruthy();
  125 |   const picker = page.getByText("Pick a pub to log a price", { exact: true });
  126 |   const gate = venueSheet(page).getByRole("heading", { name: "Sign in to add a price" });
  127 | 
  128 |   await nearby.first().click();
  129 |   await expect(gate).toBeVisible();
  130 |   await expect(venueSheet(page)).toContainText(firstVenue!);
  131 | 
  132 |   await venueSheet(page).getByRole("button", { name: "Back to Choose a pub" }).click();
  133 |   await expect(venueSheet(page)).toHaveCount(0);
  134 |   await expect(picker).toBeVisible();
  135 |   expect(contributeParam(page)).toBe("price");
  136 | 
  137 |   // The picker re-sorts around the map; take any pub but the first one.
  138 |   const another = nearby.filter({ hasNotText: firstVenue! }).first();
  139 |   const secondVenue = (await another.locator("span").first().textContent())?.trim();
  140 |   expect(secondVenue).toBeTruthy();
  141 |   await another.click();
  142 |   await expect(gate).toBeVisible();
  143 |   await expect(venueSheet(page)).toContainText(secondVenue!);
  144 |   expect(contributeParam(page)).toBe("price");
  145 | 
  146 |   await page.goBack();
  147 |   await expect(venueSheet(page)).toHaveCount(0);
  148 |   await expect(picker).toBeVisible();
```