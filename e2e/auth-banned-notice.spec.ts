import { expect, test } from "@playwright/test";

test("shows a community-guidelines ban notice when the callback is marked banned", async ({
  page,
}) => {
  await page.goto("/login?authBanned=1&_authCallback=1&authError=1");
  const notice = page.locator(".authCallbackNotice[role='alert']");
  await expect(notice).toContainText(
    "This account has been banned for not following the PubMaxx community guidelines.",
  );
  await expect(page.getByRole("link", { name: "Community guidelines" })).toHaveAttribute(
    "href",
    "/terms",
  );
});
