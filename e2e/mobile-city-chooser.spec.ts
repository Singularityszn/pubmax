import { expect, test } from "@playwright/test";

test("mobile city chooser keeps choices tappable and opens the selected city map", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  // CityChooser left the landing; /places is the picker that answers a town.
  const response = await page.goto("/places");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Pick a city." })).toBeVisible();

  const result = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll<HTMLElement>(".placesCityLink"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          label: el.textContent?.trim() ?? "",
          height: rect.height,
          width: rect.width,
          left: rect.left,
          right: rect.right,
        };
      });

    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      links,
    };
  });

  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.links.length).toBeGreaterThanOrEqual(3);
  for (const link of result.links) {
    expect(link.height, `${link.label} link height`).toBeGreaterThanOrEqual(44);
    expect(link.width, `${link.label} link width`).toBeGreaterThan(44);
    expect(link.left, `${link.label} should stay inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(link.right, `${link.label} should stay inside the viewport`).toBeLessThanOrEqual(390);
  }

  const manchester = page.getByRole("link", { name: /Manchester/ }).first();
  await expect(manchester).toHaveAttribute("href", /places\?city=manchester/);
  await Promise.all([
    page.waitForURL(/places\?city=manchester/),
    manchester.click(),
  ]);
  await expect(
    page.getByRole("heading", { level: 1, name: "Manchester", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
});
