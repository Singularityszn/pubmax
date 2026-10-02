import { expect, test } from "@playwright/test";

test("a ban flag on the URL does not show the community-guidelines notice", async ({
  page,
}) => {
  await page.goto("/login?authBanned=1&_authCallback=1&authError=1");
  await expect(page.getByText("This account has been banned for not following the PubMaxx community guidelines.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Community guidelines" })).toHaveCount(0);
});
