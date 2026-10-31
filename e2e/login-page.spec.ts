import { expect, test, type Locator, type Page } from "@playwright/test";

import { installAuthDoubles } from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

async function expectReachable(action: Locator): Promise<void> {
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport({ ratio: 1 });
  const box = await action.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(await action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(
      rect.x + rect.width / 2, rect.y + rect.height / 2,
    ));
  })).toBe(true);
}

async function appearance(action: Locator) {
  return action.evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgb = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    return {
      fill: rgb(style.backgroundColor),
      text: rgb(style.color),
      border: rgb(style.borderTopColor),
      borderWidth: parseFloat(style.borderTopWidth),
      borderStyle: style.borderTopStyle,
      radius: parseFloat(style.borderTopLeftRadius),
    };
  });
}

function luminance(color: number[]): number {
  const [r, g, b] = color.slice(0, 3).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(first: number[], second: number[]): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function openLogin(page: Page): Promise<void> {
  await installAuthDoubles(page);
  await page.goto("/login?from=%2Fmap");
  await expect(page.getByRole("button", { name: "Sign in with handle and password", exact: true })).toBeEnabled();
}

for (const width of [360, 390, 430]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`login at ${width}px in ${theme}`, () => {
      test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true, colorScheme: theme });
      test.beforeEach(({ page }) => storeThemeChoice(page, theme));

      test("both doors fit and keep every form action reachable", async ({ page }) => {
        await openLogin(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        for (const intent of ["signin", "signup"] as const) {
          await page.getByRole("tab", { name: intent === "signin" ? "Sign in" : "New here", exact: true }).click();
          await expect(page.getByRole("heading", {
            name: intent === "signin" ? "Sign in or create your account" : "Make an account", exact: true,
          })).toBeVisible();
          const form = page.getByRole("region", { name: "Sign-in options" });
          const email = form.locator('input[type="email"]');
          await email.fill("person@example.test");
          await expect(form.getByRole("button", {
            name: intent === "signin" ? "Email me a sign-in link" : "Email me a sign-up link", exact: true,
          })).toBeEnabled();
          const password = form.getByRole("button", { name: "Sign in with handle and password", exact: true });
          await expect(password).toHaveCount(intent === "signin" ? 1 : 0);
          const controls = form.locator('button:visible, input:visible');
          expect(await controls.count()).toBeGreaterThanOrEqual(4);
          for (const control of await controls.all()) await expectReachable(control);
          expect(await page.locator("main.loginPage").evaluate((element) => element.getBoundingClientRect().height))
            .toBeGreaterThanOrEqual(844);
          expect(await page.evaluate(() => document.documentElement.scrollWidth))
            .toBeLessThanOrEqual(width);
        }
      });
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`login hierarchy in ${theme}`, () => {
    test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    test.beforeEach(({ page }) => storeThemeChoice(page, theme));

    test("email stays primary with readable resting and hover labels", async ({ page }) => {
      await openLogin(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const intent of ["signin", "signup"] as const) {
        await page.getByRole("tab", { name: intent === "signin" ? "Sign in" : "New here", exact: true }).click();
        await page.locator('main input[type="email"]').fill("person@example.test");
        const primary = page.getByRole("button", {
          name: intent === "signin" ? "Email me a sign-in link" : "Email me a sign-up link", exact: true,
        });
        await expect(primary).toBeEnabled();
        await expect.poll(async () => (await appearance(primary)).fill).toEqual([214, 61, 66, 255]);
        const resting = await appearance(primary);
        expect(resting.fill).toEqual([214, 61, 66, 255]);
        expect(resting.text).toEqual([255, 255, 255, 255]);
        expect(contrast(resting.fill, resting.text)).toBeGreaterThanOrEqual(4.5);
        const selected = await appearance(page.getByRole("tab", { selected: true }));
        expect(selected.fill).not.toEqual(resting.fill);
        if (intent === "signin") {
          const secondary = await appearance(page.getByRole("button", { name: "Sign in with handle and password", exact: true }));
          expect(secondary.fill[3]).toBe(255);
          expect(secondary.fill).not.toEqual(resting.fill);
          expect(secondary.borderWidth).toBeGreaterThanOrEqual(1);
          expect(secondary.borderStyle).toBe("solid");
          expect(secondary.border).not.toEqual(secondary.fill);
          expect(secondary.radius).toBeGreaterThan(0);
          expect(contrast(secondary.fill, secondary.text)).toBeGreaterThanOrEqual(4.5);
        }
        await primary.hover();
        await expect.poll(async () => (await appearance(primary)).fill).not.toEqual(resting.fill);
        await expect.poll(async () => {
          const hovered = await appearance(primary);
          return contrast(hovered.fill, hovered.text);
        }).toBeGreaterThanOrEqual(4.5);
        expect(luminance((await appearance(primary)).fill)).toBeLessThan(luminance(resting.fill));
        await page.mouse.move(0, 0);
      }
    });
  });
}

for (const phone of [true, false]) {
  test.describe(phone ? "phone sign-in navigation" : "desktop sign-in navigation", () => {
    test.use({ viewport: { width: phone ? 390 : 1440, height: 1000 }, hasTouch: phone, isMobile: phone });

    test("opens the full sign-in page with the return destination", async ({ page }) => {
      await installAuthDoubles(page);
      await page.goto("/about");
      if (phone) {
        await page.getByRole("link", { name: "Sign in", exact: true }).click();
      } else {
        const trigger = page.getByRole("button", { name: "Sign in", exact: true });
        await expect(async () => {
          await trigger.click();
          await expect(page.getByRole("link", { name: "Open full sign-in page" })).toBeVisible({ timeout: 1_000 });
        }).toPass();
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        await expect(page).toHaveURL(/\/about$/);
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await trigger.click();
        await page.getByRole("link", { name: "Open full sign-in page" }).click();
      }
      await expect(page).toHaveURL(/\/login\?from=%2Fabout$/);
      await expect(page.getByRole("heading", { name: "Sign in or create your account", exact: true })).toBeVisible();
    });
  });
}

test("email requests preserve the selected door and its distinct destination", async ({ page, baseURL }) => {
  await page.route("https://pubmaxxing.com/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await installAuthDoubles(page);
  await page.goto("https://pubmaxxing.com/login?from=%2Fmap");
  await expect(page.getByRole("button", { name: "Sign in with handle and password", exact: true })).toBeEnabled();
  const requests: { redirect: string | null; email: string }[] = [];
  await page.route("https://pubmaxx-e2e.supabase.co/auth/v1/otp**", async (route) => {
    const request = route.request();
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    requests.push({ redirect: new URL(request.url()).searchParams.get("redirect_to"), email: request.postDataJSON().email });
    await route.fulfill({ status: 200, headers, contentType: "application/json", body: "{}" });
  });
  for (const intent of ["signin", "signup"] as const) {
    await page.getByRole("tab", { name: intent === "signin" ? "Sign in" : "New here", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`mode=${intent}`));
    await page.locator('main input[type="email"]').fill("person@example.test");
    await page.getByRole("button", {
      name: intent === "signin" ? "Email me a sign-in link" : "Email me a sign-up link", exact: true,
    }).click();
    await expect(page.getByRole("button", { name: "Link sent", exact: true })).toBeVisible();
    const sent = requests.at(-1)!;
    expect(sent.email).toBe("person@example.test");
    expect(new URL(sent.redirect!).searchParams.get("next")).toBe(intent === "signin" ? "/map" : "/u/you");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("pubmax:arrival-intent:v1")!).intent)).toBe(intent);
  }
  expect(requests).toHaveLength(2);
});
