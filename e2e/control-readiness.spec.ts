import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1309, height: 900 }, storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function delayScripts(page: Page) {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_next/static/**/*.js*", async (route) => {
    await ready;
    await route.continue();
  });
  return release;
}

for (const control of [
  { path: "/plan", name: "Import a pub list", result: "Import a pub list" },
  { path: "/plan", name: "More pages", result: "More pages" },
  { path: "/plan", name: "Open command palette", result: "Search & jump" },
  { path: "/pal", name: "Meet your Pub Pal", result: "pal-setup" },
  { path: "/near", name: "Soho →", result: "near-patch" },
  { path: "/today", name: "Pick an area instead", result: "train-area" },
  { path: "/tonight", name: "Tomorrow", result: "later-listings" },
]) {
  test(`${control.name} cannot silently drop a click while scripts load`, async ({ page }) => {
    const release = await delayScripts(page);
    try {
      await page.goto(control.path, { waitUntil: "commit" });
      const trigger = page.getByRole("button", { name: control.name, exact: true });
      await expect(trigger).toBeVisible();
      await expect(trigger).toBeDisabled();
      release();
      await expect(trigger).toBeEnabled();
      await trigger.click();
      if (control.name === "More pages") {
        await expect(page.getByRole("menu", { name: control.result, exact: true })).toBeVisible();
      } else if (control.result === "pal-setup") {
        await expect(page.getByRole("checkbox", { name: /18 or over/ })).toBeVisible();
      } else if (control.name === "Open command palette") {
        await expect(page.getByRole("dialog")).toBeVisible();
      } else if (control.result === "near-patch") {
        await expect(page.getByRole("heading", { name: "Cheapest listed around Soho" })).toBeVisible();
      } else if (control.result === "train-area") {
        await expect(page.getByRole("group", { name: "Pick an area for your last train" })).toBeVisible();
      } else if (control.result === "later-listings") {
        await expect(trigger).toHaveAttribute("aria-pressed", "true");
      } else {
        await expect(page.getByRole("dialog", { name: control.result, exact: true })).toBeVisible();
      }
    } finally {
      release();
    }
  });
}

test("the home theme control waits for scripts and answers one click", async ({ page }) => {
  const release = await delayScripts(page);
  try {
    await page.goto("/", { waitUntil: "commit" });
    const theme = page.getByRole("button", { name: /Switch to .* theme/ }).first();
    await expect(theme).toBeVisible();
    await expect(theme).toBeDisabled();
    release();
    await expect(theme).toBeEnabled();
    const previousLabel = await theme.getAttribute("aria-label");
    await theme.click();
    await expect(theme).not.toHaveAttribute("aria-label", previousLabel!);
  } finally {
    release();
  }
});

