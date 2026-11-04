import { expect, test, type Page } from "@playwright/test";
import { storeThemeChoice } from "./helpers/themeClock";
import { expectMobileMapShellReady, mobileMapShellControl } from "./helpers/mobileMapShell";

const picker = (page: Page) => page.getByLabel("Night preview");

async function openMore(page: Page) {
  const trigger = page.getByRole("button", { name: "More pages" });
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "More pages" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  return menu;
}

async function openPreviewMenu(page: Page) {
  const trigger = page.getByRole("button", { name: "More pages" });
  const menu = page.getByRole("menu", { name: "More pages" });
  await expect(async () => {
    await expect(trigger).toBeEnabled();
    if (await trigger.getAttribute("aria-expanded") !== "true") {
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
    }
    await expect(menu.getByRole("menuitem", { name: /^Round Rota/ })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  return menu;
}

test("the master switch hides the picker on phone and desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?wild=0&wildpreview=borough-bingo");
  await expect(picker(page)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await expect(picker(page)).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  const menu = await openMore(page);
  await expect(menu.getByRole("menuitem", { name: /^Round Rota/ })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /^Borough Bingo/ })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /^Pub Tarot/ })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /^Previews off/ })).toHaveCount(0);
});

test("a selected preview link preserves the other query, hash and history", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?source=before");
  await page.goto("/today?wild=1&keep=a%20b&wildpreview=round-rota&keep=two#details");
  await expect(picker(page)).toHaveValue("round-rota");
  await expect.poll(() => new URL(page.url()).search).toBe("?keep=a%20b&keep=two");
  expect(new URL(page.url()).hash).toBe("#details");
  await page.goBack();
  await expect.poll(() => new URL(page.url()).search).toBe("?source=before");
  await page.goForward();
  await expect.poll(() => new URL(page.url()).search).toBe("?keep=a%20b&keep=two");
  expect(new URL(page.url()).hash).toBe("#details");
  await expect(picker(page)).toHaveValue("round-rota");
});

test("a Tarot link selects the sourced preview and preserves unrelated address values", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?wild=1&wildpreview=pub-tarot&keep=1#details");
  await expect(picker(page)).toHaveValue("pub-tarot");
  await expect.poll(() => new URL(page.url()).search).toBe("?keep=1");
  expect(new URL(page.url()).hash).toBe("#details");
});

for (const host of [
  { name: "SiteNav", path: "/today", header: ".siteNavBar", map: false },
  { name: "Home", path: "/", header: ".lpNav", map: false },
  { name: "Plan", path: "/plan", header: ".siteNavBar", map: false },
  { name: "Map", path: "/map", header: ".mobileMapTopbar", map: true },
  { name: "town Map", path: "/map?place=Sheffield&lat=53.3800941&lng=-1.4789213", header: ".mobileMapTopbar", map: true },
]) {
  for (const theme of ["light", "dark"] as const) {
    test(`${host.name} phone picker follows the header in ${theme} with enlarged text`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await storeThemeChoice(page, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      await page.goto(`${host.path}${host.path.includes("?") ? "&" : "?"}wild=1`);
      if (host.map) await expectMobileMapShellReady(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const select = picker(page);
      await expect(select).toHaveCount(1);
      await expect(select).toBeVisible();
      // Wait for the client picker and applied text size before measuring layout.
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await expect.poll(() => page.locator("html").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(32);
      await page.evaluate(() => document.fonts.ready);
      await expect(select).toHaveValue("off");
      await expect(select.locator("option")).toHaveText(["Previews off", "Round Rota", "Borough Bingo", "Pub Tarot"]);
      const nav = page.locator(host.header);
      const navBox = await nav.boundingBox();
      const selectBox = await select.boundingBox();
      const wrapper = page.locator(".wildNightPreviewMobile");
      const wrapperBox = await wrapper.boundingBox();
      expect(navBox).not.toBeNull();
      expect(selectBox).not.toBeNull();
      expect(wrapperBox).not.toBeNull();
      expect(wrapperBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height - 1);
      expect(selectBox!.x).toBeGreaterThanOrEqual(0);
      expect(selectBox!.x + selectBox!.width).toBeLessThanOrEqual(390);
      expect(await select.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
      expect(await wrapper.evaluate((element) => getComputedStyle(element).position)).toBe("static");
      expect(await wrapper.evaluate((element) => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (["fixed", "absolute"].includes(getComputedStyle(parent).position) && parent.classList.contains("mobileMapChrome")) return false;
        }
        return true;
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await select.focus();
      await expect(select).toBeFocused();
      await page.keyboard.press("Space");
      await page.keyboard.press("b");
      await page.keyboard.press("Enter");
      await expect(select).toHaveValue("borough-bingo");
      await page.screenshot({ path: testInfo.outputPath("phone-picker-200.png") });

      if (host.map) {
        const chrome = page.locator(".mobileMapChrome");
        const canvas = page.locator(".mapStage > .mapCanvasWrap");
        await expect.poll(async () => {
          const chromeBox = await chrome.boundingBox();
          const canvasBox = await canvas.boundingBox();
          return Boolean(chromeBox && canvasBox && canvasBox.y >= chromeBox.y + chromeBox.height && canvasBox.height > 0);
        }).toBe(true);
        const canvasBox = await canvas.boundingBox();
        expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(845);
        const search = await mobileMapShellControl(page, "search");
        expect(await search.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })).toBe(true);
        await search.focus();
        await page.keyboard.press("Enter");
        await expect(search).toHaveAttribute("aria-expanded", "true");
        await expect(select).toHaveValue("borough-bingo");
        await search.focus();
        await page.keyboard.press("Enter");
        await expect(search).toHaveAttribute("aria-expanded", "false");
      }

      await select.evaluate((element) => { element.dataset.navigationProof = "mounted"; });
      await page.evaluate(() => {
        const address = new URL(window.location.href);
        address.searchParams.set("wildpreview", "off");
        window.history.pushState({ retained: true }, "", `${address.pathname}${address.search}#details`);
      });
      await expect(select).toHaveValue("off");
      await expect(select).toHaveAttribute("data-navigation-proof", "mounted");
      await expect.poll(() => new URL(page.url()).searchParams.has("wildpreview")).toBe(false);
      expect(new URL(page.url()).hash).toBe("#details");
      expect(await page.evaluate(() => window.history.state.retained)).toBe(true);
      await page.evaluate(() => {
        const address = new URL(window.location.href);
        address.searchParams.set("wild", "0");
        window.history.pushState(null, "", `${address.pathname}${address.search}`);
      });
      await expect(select).toHaveCount(0);
    });
  }
}

test("desktop choices stay in More and work with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/today?wild=1");
  await expect(picker(page)).toBeHidden();
  const menu = await openPreviewMenu(page);
  const labels = await menu.locator(".siteNavMoreLabel").allTextContents();
  expect(labels.slice(-4)).toEqual(["Previews off", "Round Rota", "Borough Bingo", "Pub Tarot"]);
  await expect(menu.getByRole("menuitem").filter({ hasText: /Selected on this browser|Select this public preview/ })).toHaveCount(4);
  await page.keyboard.press("End");
  const tarot = menu.getByRole("menuitem", { name: /^Pub Tarot/ });
  await expect(tarot).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  const reopened = await openPreviewMenu(page);
  await expect(reopened.getByRole("menuitem", { name: /^Pub Tarot/ })).toContainText("Selected on this browser");
});

test("phone native picker opens, selects and commits with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?wild=1");
  const select = picker(page);
  await expect(select).toBeVisible();
  await expect(select).toHaveValue("off");
  await select.focus();
  await expect(select).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("b");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue("borough-bingo");
});

test("two tabs receive real storage changes from the other tab", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?wild=1");
  await expect(picker(page)).toBeVisible();
  const other = await context.newPage();
  await other.setViewportSize({ width: 390, height: 844 });
  await other.goto("/today");
  await expect(picker(other)).toBeVisible();

  await picker(page).selectOption("round-rota");
  await expect(picker(other)).toHaveValue("round-rota");
  await picker(other).selectOption("borough-bingo");
  await expect(picker(page)).toHaveValue("borough-bingo");
  await picker(page).selectOption("pub-tarot");
  await expect(picker(other)).toHaveValue("pub-tarot");
  await picker(page).selectOption("off");
  await expect(picker(other)).toHaveValue("off");

  await page.goto("/today?wild=0");
  await expect(picker(page)).toHaveCount(0);
  await expect(picker(other)).toHaveCount(0);
  await other.goto("/today?wild=1");
  await expect(picker(other)).toBeVisible();
  await expect(picker(page)).toBeVisible();
  await other.close();
});

test("a query-only off link updates the mounted picker", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?wild=1&wildpreview=borough-bingo");
  const select = picker(page);
  await expect(select).toHaveValue("borough-bingo");
  await select.evaluate((element) => { element.dataset.navigationProof = "mounted"; });
  await page.evaluate(() => window.history.pushState({ kept: true }, "", "/today?keep=1&wildpreview=off#details"));
  await expect(select).toHaveValue("off");
  await expect(select).toHaveAttribute("data-navigation-proof", "mounted");
  await expect.poll(() => new URL(page.url()).search).toBe("?keep=1");
  expect(new URL(page.url()).hash).toBe("#details");
  expect(await page.evaluate(() => window.history.state.kept)).toBe(true);
});

function observeTarotNetwork(page: Page) {
  const chunks: string[] = [];
  const heritage: Array<{ url: string; method: string; body: string | null }> = [];
  const inspections: Promise<void>[] = [];
  const readErrors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/data/heritage_listings.json") {
      heritage.push({ url: request.url(), method: request.method(), body: request.postData() });
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== new URL(page.url()).origin || !url.pathname.startsWith("/_next/static/chunks/")
      || response.request().resourceType() !== "script") return;
    // Observe the real emitted code. Its public wording identifies the optional
    // module without depending on a previous build's hashed chunk filename.
    inspections.push(response.text().then((body) => {
      if (body.includes("The card titles are playful.")) chunks.push(response.url());
    }, (error: unknown) => {
      readErrors.push(String(error));
    }));
  });
  return {
    chunks,
    heritage,
    async settled() {
      await page.waitForLoadState("networkidle");
      await Promise.all(inspections);
      expect(readErrors).toEqual([]);
    },
  };
}

async function installLocationRefusal(page: Page) {
  await page.addInitScript(() => {
    const state = window as typeof window & { tarotLocationRequests: number };
    state.tarotLocationRequests = 0;
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(_found: PositionCallback, refused?: PositionErrorCallback | null) {
          state.tarotLocationRequests += 1;
          refused?.({ code: 1, message: "Browser fixture refuses location", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        },
      },
    });
  });
}

async function locationRequests(page: Page) {
  return page.evaluate(() => (window as typeof window & { tarotLocationRequests: number }).tarotLocationRequests);
}

test.describe("Pub Tarot lazy browser boundary", () => {
  test.use({ serviceWorkers: "block" });

  for (const query of [
    "wild=0&wildpreview=pub-tarot",
    "wild=1&wildpreview=off",
    "wild=1&wildpreview=round-rota",
    "wild=1&wildpreview=borough-bingo",
  ]) {
    test("normal roulette fetches no Tarot code or heritage with " + query, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await installLocationRefusal(page);
      const reads = observeTarotNetwork(page);
      await page.goto("/near?" + query);
      await expect(page.getByRole("heading", { name: "Pint roulette", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Surprise me", exact: true })).toBeEnabled();
      await reads.settled();
      await expect(page.getByRole("heading", { name: "Pub Tarot", exact: true })).toHaveCount(0);
      expect(reads.chunks).toEqual([]);
      expect(reads.heritage).toEqual([]);
      expect(await locationRequests(page)).toBe(0);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test("a keyboard draw alone reads real heritage and renders three sourced pubs at 390px in " + theme, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await storeThemeChoice(page, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await installLocationRefusal(page);
      const reads = observeTarotNetwork(page);
      await page.goto("/near?wild=1&wildpreview=off");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("heading", { name: "Pint roulette", exact: true })).toBeVisible();
      const select = picker(page);
      await expect(select).toBeVisible();
      await reads.settled();
      expect(reads.chunks).toEqual([]);
      expect(reads.heritage).toEqual([]);
      expect(await locationRequests(page)).toBe(0);

      await select.selectOption("pub-tarot");
      const preview = page.getByRole("region", { name: "Pub Tarot", exact: true });
      const draw = preview.getByRole("button", { name: "Draw three pubs", exact: true });
      await expect(draw).toBeEnabled();
      await reads.settled();
      expect(reads.chunks.length).toBeGreaterThan(0);
      expect(reads.heritage).toEqual([]);
      expect(await locationRequests(page)).toBe(0);
      await expect(page.getByRole("heading", { name: "Pint roulette", exact: true })).toHaveCount(0);

      const writes: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.origin === new URL(page.url()).origin && url.pathname.startsWith("/api/")
          && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(request.url());
      });
      const assetReply = page.waitForResponse((response) => new URL(response.url()).pathname === "/data/heritage_listings.json");
      await draw.focus();
      await page.keyboard.press("Enter");
      const response = await assetReply;
      expect(response.status()).toBe(200);
      const source = await response.json() as {
        listings: Record<string, { fact: string; url: string; listEntry: number }>;
      };
      const cards = preview.locator(".pubTarotCards > li");
      await expect(cards).toHaveCount(3);
      await expect(cards.getByRole("heading", { level: 3 })).toHaveText(["Where you were", "Where you are", "Where you are going"]);
      const ids: string[] = [];
      for (const card of await cards.all()) {
        const pub = card.locator(".pubTarotName");
        const name = (await pub.innerText()).trim();
        const href = await pub.getAttribute("href");
        expect(href).not.toBeNull();
        const id = new URL(href!, page.url()).searchParams.get("sel");
        expect(id).not.toBeNull();
        ids.push(id!);
        const listing = source.listings[id!];
        expect(listing).toBeDefined();
        await expect(card).toContainText(listing!.fact);
        const citation = card.getByRole("link", { name: "Historic England listing for " + name, exact: true });
        await expect(citation).toHaveAttribute("href", listing!.url);
        const citationUrl = new URL(listing!.url);
        expect(citationUrl.origin).toBe("https://historicengland.org.uk");
        expect(citationUrl.pathname.replace(/\/$/, "")).toBe("/listing/the-list/list-entry/" + listing!.listEntry);
        expect(citationUrl.search).toBe("");
        expect(citationUrl.hash).toBe("");
        await expect(card).not.toContainText(/£\s*\d/);
      }
      expect(new Set(ids).size).toBe(3);
      await expect(preview).toContainText("No location, so this draw is from central London.");
      await expect(preview).toContainText("They do not describe your past or predict your future.");
      await expect(preview.getByRole("button", { name: "Draw again", exact: true })).toBeFocused();
      await reads.settled();
      expect(await locationRequests(page)).toBe(1);
      expect(reads.heritage).toHaveLength(1);
      expect(new URL(reads.heritage[0]!.url).search).toBe("");
      expect(reads.heritage[0]!.method).toBe("GET");
      expect(reads.heritage[0]!.body).toBeNull();
      expect(writes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await testInfo.attach("tarot-real-asset-network", {
        body: JSON.stringify({ theme, viewport: "390x844", location: "refusal fixture", chunks: reads.chunks, heritage: reads.heritage, ids, writes }),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("tarot-390-" + theme + ".png"), animations: "disabled" });
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await expect.poll(() => page.locator("html").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(32);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await expect(preview.getByRole("button", { name: "Draw again", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("tarot-390-" + theme + "-200.png"), animations: "disabled" });
    });
  }
});
