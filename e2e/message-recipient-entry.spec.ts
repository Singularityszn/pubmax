import { expect, test, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

async function installInbox(page: Page) {
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await auth.signedInAs("A");
  await page.route("**/api/messages?**", route => route.fulfill({ json: {
    conversations: [{ id: "c1", otherHandle: "sam", lastAt: new Date().toISOString(), lastFromMe: false }],
  } }));
  await page.route("**/api/messages/c1**", route => route.fulfill({ json: {
    messages: [], otherHandle: "sam", conversationId: "c1",
  } }));
}

async function recipientButtonContrast(button: Locator) {
  return button.evaluate(element => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Color measurement needs a canvas context");
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).map(value => value / 255);
    };
    const over = (front: number[], back: number[]) =>
      front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3]));
    const background = (node: Element | null): number[] => {
      if (!node) throw new Error("No opaque background found for recipient control");
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none" || Number(style.opacity) !== 1) {
        throw new Error("Recipient contrast measurement needs flat, fully opaque layers");
      }
      const color = rgba(style.backgroundColor);
      return color[3] === 1 ? color.slice(0, 3) : over(color, background(node.parentElement));
    };
    const luminance = (color: number[]) => color.map(value =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    ).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (first: number[], second: number[]) => {
      const values = [luminance(first), luminance(second)];
      return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
    };
    const style = getComputedStyle(element);
    const surface = background(element);
    const surroundings = background(element.parentElement);
    return {
      color: style.color, backgroundColor: style.backgroundColor,
      surface, surroundings, outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth),
      outlineOffset: parseFloat(style.outlineOffset),
      focusVisible: element.matches(":focus-visible"),
      textRatio: ratio(over(rgba(style.color), surface), surface),
      outlineRatio: ratio(over(rgba(style.outlineColor), surroundings), surroundings),
    };
  });
}

for (const width of [390, 1440]) {
  test.describe(`recipient entry at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const theme of ["light", "dark"] as const) {
      test(`recipient Message contrast in normal, hover and keyboard focus states in ${theme}`, async ({ page }, testInfo) => {
        await installInbox(page);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.addInitScript(value => localStorage.setItem("pubmax-theme", value), theme);
        await page.route("**/api/profiles/search?**", route => route.fulfill({
          json: { matches: [{ handle: "sam", displayName: "Sam Patel" }] },
        }));
        await page.goto("/messages/new");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.getByRole("searchbox", { name: "Search handles" }).fill("sam");
        await page.getByRole("button", { name: "Search", exact: true }).click();
        const row = page.locator(".messageRecipientRow");
        await expect(row).toHaveCount(1);
        const button = row.getByRole("button", { name: "Message", exact: true });
        await expect(button).toBeVisible();
        await page.mouse.move(0, 0);
        const normal = await recipientButtonContrast(button);
        await button.hover();
        const hover = await recipientButtonContrast(button);
        await page.mouse.move(0, 0);
        await row.getByRole("link").focus();
        await page.keyboard.press("Tab");
        await expect(button).toBeFocused();
        const focus = await recipientButtonContrast(button);
        await testInfo.attach("recipient-message-contrast", {
          body: JSON.stringify({ width, theme, normal, hover, focus }),
          contentType: "application/json",
        });
        await page.screenshot({ path: testInfo.outputPath(`recipient-message-focus-${theme}-${width}.png`) });
        for (const [state, measured] of Object.entries({ normal, hover, focus })) {
          expect.soft(measured.textRatio, `${state} Message text contrast`).toBeGreaterThanOrEqual(4.5);
        }
        expect(focus.focusVisible).toBe(true);
        expect(focus.outlineStyle).not.toBe("none");
        expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
        expect(focus.outlineOffset).toBeGreaterThanOrEqual(2);
        expect(focus.outlineRatio, "keyboard focus indicator contrast").toBeGreaterThanOrEqual(3);
      });
    }

    test("inbox opens recipient search, retries a failed read, and opens the existing conversation", async ({ page }, testInfo) => {
      await installInbox(page);
      await page.addInitScript(() => {
        const runtime = window as typeof window & { recipientErrorResponse?: Response };
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const response = await originalFetch(input, init);
          const url = new URL(input instanceof Request ? input.url : String(input), location.href);
          if (url.pathname === "/api/profiles/search" && !response.ok) {
            runtime.recipientErrorResponse = response;
          }
          return response;
        };
      });
      let searches = 0;
      const actions: unknown[] = [];
      await page.route("**/api/profiles/search?**", route => {
        searches++;
        return route.fulfill(searches === 1
          ? { status: 503, json: { error: "Unavailable" } }
          : { json: { matches: [{ handle: "sam" }, { handle: ACCOUNTS.A.handle }] } });
      });
      await page.route("**/api/messages", route => {
        actions.push(route.request().postDataJSON());
        return route.fulfill({ json: { conversationId: "c1" } });
      });
      await page.goto("/messages");
      await expect(page.locator(".conversationList li")).toHaveCount(1);
      await page.getByRole("link", { name: "New message", exact: true }).click();
      await expect(page).toHaveURL(/\/messages\/new$/);
      await expect(page.getByRole("heading", { name: "New message", exact: true })).toBeVisible();
      await page.getByRole("searchbox", { name: "Search handles" }).fill("sam");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Could not search. Try again." })).toBeVisible();
      // The actual failed fetch body is released before another action aborts it.
      await expect.poll(() => page.evaluate(() => (
        window as typeof window & { recipientErrorResponse?: Response }
      ).recipientErrorResponse?.bodyUsed)).toBe(true);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const result = page.locator(".messageRecipientRow");
      await expect(result).toHaveCount(1);
      await expect(result.getByRole("link")).toHaveText("@sam");
      for (const control of [
        page.getByRole("link", { name: "Back to messages", exact: true }),
        page.getByRole("searchbox", { name: "Search handles" }),
        page.getByRole("button", { name: "Search", exact: true }),
        result.getByRole("link"),
        result.getByRole("button", { name: "Message", exact: true }),
      ]) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      await expect(page.getByRole("heading", { name: "New message", exact: true })).toHaveClass("screenTitle");
      await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveClass(/uiButton--primary/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`recipients-${width}.png`), fullPage: true });
      await result.getByRole("button", { name: "Message", exact: true }).click();
      await expect(page).toHaveURL(/\/messages\/c1$/);
      expect(actions).toEqual([{ action: "open", handle: ACCOUNTS.A.handle, other: "sam" }]);
    });

    for (const founding of [false, true]) {
      test(`keeps recipient controls clear of the ${founding ? "founding" : "plain"} greeting without a dismissal jump`, async ({ page }, testInfo) => {
        await installInbox(page);
        const time = new Date();
        await page.clock.install({ time });
        await page.clock.pauseAt(new Date(time.getTime() + 60_000));
        await page.addInitScript(() => {
          sessionStorage.setItem("pubmax:arrival-welcome:v1", JSON.stringify({ intent: "signin", at: Date.now() }));
        });
        await page.route("**/api/identity/handle/current", route => route.fulfill({ json: {
          handle: ACCOUNTS.A.handle, foundingMemberNumber: founding ? 1 : null,
        } }));
        await page.route("**/api/profiles/search?**", route => route.fulfill({ json: { matches: [
          { handle: "sam_patel", displayName: "Sam Patel" }, { handle: "sam_taylor", displayName: "Samantha Alexandra Taylor-Williams" },
          { handle: "sam_jones", displayName: "Sam Jones" }, { handle: "sam_chen", displayName: "Sam Chen" },
          { handle: "sam_brown", displayName: "Sam Brown" }, { handle: "sam_wilson", displayName: "Samuel Alexander Wilson-Clarke" },
          { handle: "sam_clarke", displayName: "Sam Clarke" }, { handle: "sam_ali", displayName: "Sam Ali" },
        ] } }));
        await page.goto(founding ? "/messages" : "/messages/new", { waitUntil: "commit" });
        const welcome = page.locator(".arrivalWelcome");
        await expect.poll(async () => {
          await page.clock.runFor(50);
          if (!await welcome.isVisible()) return false;
          return !founding || await welcome.getAttribute("data-founding") === "";
        }).toBe(true);
        await expect(welcome).toBeVisible();
        if (founding) {
          await page.getByRole("link", { name: "New message", exact: true }).click();
          await expect(page).toHaveURL(/\/messages\/new$/);
        }
        await expect(page.locator(".messageRecipientArrival .arrivalWelcome")).toBeVisible();
        await page.getByRole("link", { name: "Back to messages", exact: true }).click();
        await expect(page).toHaveURL(/\/messages$/);
        await expect(page.locator(".messageRecipientArrival .arrivalWelcome")).toHaveCount(0);
        await expect(welcome).toBeVisible();
        await page.getByRole("link", { name: "New message", exact: true }).click();
        await expect(page.locator(".messageRecipientArrival .arrivalWelcome")).toBeVisible();
        if (founding) await expect(welcome).toHaveAttribute("data-founding", "");
        await page.evaluate(() => document.fonts.ready);
        const search = page.getByRole("searchbox", { name: "Search handles" });
        await search.focus();
        const greeting = await welcome.boundingBox();
        expect(greeting).not.toBeNull();
        expect(greeting!.x).toBeGreaterThanOrEqual(0);
        expect(greeting!.y).toBeGreaterThanOrEqual(0);
        expect(greeting!.x + greeting!.width).toBeLessThanOrEqual(width);
        expect(greeting!.y + greeting!.height).toBeLessThanOrEqual(900);
        const mobileChrome = width <= 640 ? [page.locator(".createFab"), page.locator(".mobileTabBar")] : [];
        for (const chrome of mobileChrome) await expect(chrome).toBeVisible();
        for (const control of [
          page.getByRole("link", { name: "Back to messages", exact: true }),
          page.getByRole("heading", { name: "New message", exact: true }), search,
          page.getByRole("button", { name: "Search", exact: true }), ...mobileChrome,
        ]) {
          const box = await control.boundingBox();
          expect(box).not.toBeNull();
          const overlap = Math.max(0, Math.min(box!.x + box!.width, greeting!.x + greeting!.width) - Math.max(box!.x, greeting!.x)) *
            Math.max(0, Math.min(box!.y + box!.height, greeting!.y + greeting!.height) - Math.max(box!.y, greeting!.y));
          expect(overlap).toBe(0);
        }
        await page.screenshot({ path: testInfo.outputPath(`recipient-welcome-${founding}-${width}.png`), animations: "disabled" });
        await search.fill("sam");
        await page.getByRole("button", { name: "Search", exact: true }).click();
        const rows = page.locator(".messageRecipientRow");
        await expect(rows).toHaveCount(8);
        await expect(welcome).toBeVisible();
        for (let index = 0; index < 8; index++) {
          const row = rows.nth(index);
          await row.evaluate(element => element.scrollIntoView({ block: "center" }));
          for (const target of [row.getByRole("link"), row.getByRole("button", { name: "Message", exact: true })]) {
            expect(await target.evaluate(element => {
              const box = element.getBoundingClientRect();
              const toast = document.querySelector(".arrivalWelcome")!.getBoundingClientRect();
              const overlap = Math.max(0, Math.min(box.right, toast.right) - Math.max(box.left, toast.left)) *
                Math.max(0, Math.min(box.bottom, toast.bottom) - Math.max(box.top, toast.top));
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return overlap === 0 && box.top >= 0 && box.bottom <= innerHeight && hit !== null && element.contains(hit);
            })).toBe(true);
          }
        }
        await search.focus();
        await page.screenshot({ path: testInfo.outputPath(`recipient-eight-matches-${founding}-${width}.png`), animations: "disabled" });
        const focusedBeforeDismiss = await search.boundingBox();
        await page.clock.runFor(13_000);
        await expect(welcome).toHaveCount(0);
        await expect(search).toBeFocused();
        expect(await search.boundingBox()).toEqual(focusedBeforeDismiss);
        await page.screenshot({ path: testInfo.outputPath(`recipient-no-welcome-${founding}-${width}.png`), animations: "disabled" });
      });
    }

    test("does not offer a handle claim while canonical identity is pending", async ({ page }) => {
      await installInbox(page);
      let releaseIdentity!: () => void;
      const held = new Promise<void>(resolve => { releaseIdentity = resolve; });
      let requested = false;
      await page.route("**/api/identity/handle/current", async route => {
        requested = true;
        await held;
        await route.fulfill({ json: { handle: ACCOUNTS.A.handle } });
      });
      try {
        await page.goto("/messages/new");
        await expect.poll(() => requested).toBe(true);
        await expect(page.getByRole("status").filter({ hasText: "Checking your account" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Claim a handle to message" })).toHaveCount(0);
        await expect(page.getByRole("searchbox", { name: "Search handles" })).toHaveCount(0);
      } finally {
        releaseIdentity();
      }
      await expect(page.getByRole("searchbox", { name: "Search handles" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Claim a handle to message" })).toHaveCount(0);
    });
  });
}
