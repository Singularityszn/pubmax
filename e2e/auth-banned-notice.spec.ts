import { expect, test } from "@playwright/test";

test("a ban flag on the URL does not show the community-guidelines notice", async ({
  page,
}) => {
  await page.goto("/login?authBanned=1&_authCallback=1&authError=1");
  const notice = page.locator(".authCallbackNotice[role='alert']");
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText(
    "Sign-in could not be completed. The link may be invalid or expired. Try again.",
  );
  await expect(page.getByText("This account has been banned for not following the PubMaxx community guidelines.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Community guidelines" })).toHaveCount(0);
  // Next's navigation announcer is a separate alert and keeps its live semantics.
  const announcer = page.locator("#__next-route-announcer__");
  await expect(announcer).toHaveAttribute("role", "alert");
  await expect(announcer).toHaveAttribute("aria-live", "assertive");
});
