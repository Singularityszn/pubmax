import { expect, test, type Page } from "@playwright/test";

const DESKTOP_CASES = [
  { width: 1024, height: 768, theme: "light" },
  { width: 1024, height: 768, theme: "dark" },
  { width: 1280, height: 800, theme: "light" },
  { width: 1280, height: 800, theme: "dark" },
  { width: 1440, height: 900, theme: "light" },
  { width: 1440, height: 900, theme: "dark" },
  { width: 1920, height: 1080, theme: "light" },
  { width: 1920, height: 1080, theme: "dark" },
] as const;

const SIGNED_OUT_FITTED_SELECTOR =
  ".messagesInboxPane .emptyStateTitle, .messagesInboxPane .emptyStateLine";

async function expectSignedOutCardFitsInbox(page: Page): Promise<void> {
  // The signed-out card is the EmptyState idiom: its title is a line, not a
  // heading, so the pane's one heading stays the route's own.
  const heading = page.locator(".messagesInboxPane .emptyStateTitle", {
    hasText: "Your conversations show here.",
  });
  const fitted = page.locator(SIGNED_OUT_FITTED_SELECTOR);

  await expect(heading).toBeVisible();
  // Title and one line. The head's primary is the one door to /login (the
  // email-link flow lives on that page), so the card carries no second copy.
  await expect(fitted).toHaveCount(2);
  await expect(page.locator(".messagesInboxPane .emptyState a")).toHaveCount(0);
  await expect(
    page.locator(".messagesInboxPane").getByRole("link", { name: "Sign in", exact: true }),
  ).toHaveAttribute("href", "/login?mode=signin&from=%2Fmessages");
  const geometry = await page.evaluate((fittedSelector) => {
    const inboxNode = document.querySelector<HTMLElement>(".messagesInboxPane");
    const cardNode = document.querySelector<HTMLElement>(".messagesInboxPane .emptyState");
    const fittedNodes = [
      ...document.querySelectorAll<HTMLElement>(fittedSelector),
    ];
    if (!inboxNode || !cardNode) return null;

    return {
      inboxRight: inboxNode.getBoundingClientRect().right,
      cardLeft: cardNode.getBoundingClientRect().left,
      cardRight: cardNode.getBoundingClientRect().right,
      cardFits: cardNode.scrollWidth <= cardNode.clientWidth,
      fitted: fittedNodes.map((node) => ({
        className: node.className,
        left: node.getBoundingClientRect().left,
        right: node.getBoundingClientRect().right,
        fits: node.scrollWidth <= node.clientWidth,
      })),
    };
  }, SIGNED_OUT_FITTED_SELECTOR);

  expect(geometry).not.toBeNull();
  if (!geometry) return;
  expect(geometry.cardFits).toBe(true);
  // The EmptyState idiom is start-aligned under its heading (de-box rule in
  // docs/DESIGN_SYSTEM.md), so the check is that every line fits inside the
  // card and the inbox, never that it sits on a centre line.
  for (const item of geometry.fitted) {
    expect(item.fits, `${item.className} should fit its own box`).toBe(true);
    expect(item.right, `${item.className} should stay inside card`).toBeLessThanOrEqual(
      geometry.cardRight + 1,
    );
    expect(item.right, `${item.className} should stay inside inbox`).toBeLessThanOrEqual(
      geometry.inboxRight + 1,
    );
  }
}

for (const viewport of DESKTOP_CASES) {
  test(`signed-out messages are one column with one door at ${viewport.width}px in ${viewport.theme} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript((theme) => {
      window.localStorage.setItem("pubmax-theme", theme);
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_handle", "messages-layout-viewer");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, viewport.theme);

    await page.goto("/messages");
    if (viewport.theme === "dark") {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    } else {
      await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    }
    await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
    // SIGNED OUT there is no inbox and no thread to frame (taste plan,
    // 18 Oct 2026): the two-pane panel folds away, and the page is the head's
    // one door over one empty state.
    await expect(page.locator(".messagesThreadPane")).toBeHidden();
    await expect(page.locator(".messagesSplit")).toHaveCSS("border-top-width", "0px");
    await expect(page.getByRole("heading", { name: "Pick a message" })).toHaveCount(0);
    await expectSignedOutCardFitsInbox(page);

    await page.goto("/messages/nonexistent");
    await expect(page.locator(".messagesThreadPane")).toBeHidden();
    await expect(
      page.locator(".messagesInboxPane .emptyStateTitle", { hasText: "Your conversations show here." }),
    ).toBeVisible();
  });
}
