import { expect, test } from "@playwright/test";

test("concierge picks become a public Plan that a mate joins with only a name", async ({
  browser,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Describe the night. We’ll put it in order." })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);

  await page.getByLabel("Describe the night").fill("Quiet in Clapham for 4, not pricey");
  await page.getByRole("button", { name: "Plan my night" }).click();
  await expect(page.getByText("Three grounded stops, shaped by the editable context below.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Area/i })).toHaveValue("clapham");
  await expect(page.getByRole("spinbutton", { name: /People/i })).toHaveValue("4");
  await page.getByText("Night Area coverage").click();
  await expect(page.getByRole("heading", { name: "Ready to plan now" })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);

  await page.getByLabel("Your name").fill("Karan");
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Who.s in/ })).toBeVisible();
  await expect(page.getByText("Karan", { exact: true })).toBeVisible();
  const publicUrl = page.url();

  const mate = await browser.newContext();
  await mate.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });
  const matePage = await mate.newPage();
  await matePage.setViewportSize({ width: 390, height: 844 });
  await matePage.goto(publicUrl);
  await expect(matePage.getByText("No account. Just your name.")).toBeVisible();
  await expect
    .poll(async () =>
      matePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);
  await matePage.getByLabel("No account. Just your name.").fill("Luna");
  await matePage.getByRole("button", { name: /I.m in/ }).click();
  await expect(matePage.getByText("Luna", { exact: true })).toBeVisible();
  await mate.close();
});
