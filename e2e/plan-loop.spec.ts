import { expect, test } from "@playwright/test";

test("concierge picks become a public Plan that a mate joins with only a name", async ({
  browser,
  page,
}) => {
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Put the night in order." })).toBeVisible();

  await page.getByLabel("Describe the night").fill("Quiet near Bank for 4, not pricey");
  await page.getByRole("button", { name: "Sort it" }).click();
  await expect(page.getByText(/Grounded picks added|Start at/)).toBeVisible();

  await page.getByLabel("Your name").fill("Karan");
  await page.getByRole("button", { name: "Make it a Plan" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Who.s in/ })).toBeVisible();
  await expect(page.getByText("Karan", { exact: true })).toBeVisible();
  const publicUrl = page.url();

  const mate = await browser.newContext();
  const matePage = await mate.newPage();
  await matePage.goto(publicUrl);
  await expect(matePage.getByText("No account. Just your name.")).toBeVisible();
  await matePage.getByLabel("No account. Just your name.").fill("Luna");
  await matePage.getByRole("button", { name: /I.m in/ }).click();
  await expect(matePage.getByText("Luna", { exact: true })).toBeVisible();
  await mate.close();
});
