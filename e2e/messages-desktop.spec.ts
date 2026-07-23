import { expect, test, type Page } from "@playwright/test";

const DESKTOP_CASES = [
  { width: 1280, height: 800, theme: "light" },
  { width: 1280, height: 800, theme: "dark" },
  { width: 1440, height: 900, theme: "light" },
  { width: 1440, height: 900, theme: "dark" },
] as const;

async function expectDesktopSplit(page: Page): Promise<void> {
  const split = page.locator(".messagesSplit");
  const inbox = page.locator(".messagesInboxPane");
  const thread = page.locator(".messagesThreadPane");

  await expect(split).toBeVisible();
  await expect(inbox).toBeVisible();
  await expect(thread).toBeVisible();

  const [splitBox, inboxBox, threadBox] = await Promise.all([
    split.boundingBox(),
    inbox.boundingBox(),
    thread.boundingBox(),
  ]);
  expect(splitBox).not.toBeNull();
  expect(inboxBox).not.toBeNull();
  expect(threadBox).not.toBeNull();
  if (!splitBox || !inboxBox || !threadBox) return;

  expect(splitBox.width).toBeGreaterThan(900);
  expect(inboxBox.width).toBeGreaterThanOrEqual(300);
  expect(threadBox.width).toBeGreaterThan(500);
  expect(threadBox.x).toBeGreaterThan(inboxBox.x + inboxBox.width - 2);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

for (const viewport of DESKTOP_CASES) {
  test(`messages use inbox and thread panes at ${viewport.width}px in ${viewport.theme} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript((theme) => {
      window.localStorage.setItem("pubmax-theme", theme);
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, viewport.theme);

    await page.goto("/messages");
    if (viewport.theme === "dark") {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    } else {
      await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    }
    await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pick a message" })).toBeVisible();
    await expectDesktopSplit(page);

    await page.goto("/messages/nonexistent");
    await expect(page.getByText(/sign in to read and send messages/i)).toBeVisible();
    await expectDesktopSplit(page);
  });
}
