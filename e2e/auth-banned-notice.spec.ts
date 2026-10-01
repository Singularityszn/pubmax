import { expect, test } from "@playwright/test";

test("shows a community-guidelines ban notice when the callback is marked banned", async ({
  page,
}) => {
  await page.goto("/login?authBanned=1&_authCallback=1&authError=1");
  const notice = page.locator(".authCallbackNotice[role='alert']");
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText(
    "This account has been banned for not following the PubMaxx community guidelines.",
  );
  await expect(notice.getByRole("link", { name: "Community guidelines" })).toHaveAttribute(
    "href",
    "/terms",
  );
  // Next's navigation announcer is a separate alert and keeps its live semantics.
  const announcer = page.locator("#__next-route-announcer__");
  await expect(announcer).toHaveAttribute("role", "alert");
  await expect(announcer).toHaveAttribute("aria-live", "assertive");
});
