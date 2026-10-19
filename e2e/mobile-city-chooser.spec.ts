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

  // ONE CITY SAYS SO (taste plan, 18 Oct 2026): the list view names London as
  // the only city with listed prices and paints ONE door to it, the Screen
  // primary, with the city request beside it. The town lookup keeps its own
  // heading below. So the choices a thumb has at rest are that door and the
  // request, and every town row once a search answers.
  await expect(page.getByRole("heading", { level: 1, name: "London only, for now." })).toBeVisible();
  const door = page.locator("main [data-primary-action]").getByRole("link", { name: "Open London" });
  await expect(door).toBeVisible();
  await expect(door).toHaveAttribute("href", /\/places\?city=london/);

  const measureChoices = (selector: string) =>
    page.evaluate((choiceSelector) => {
      const links = Array.from(document.querySelectorAll<HTMLElement>(choiceSelector))
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
    }, selector);
  const expectTappable = (links: { label: string; height: number; width: number; left: number; right: number }[]) => {
    for (const link of links) {
      expect(link.height, `${link.label} link height`).toBeGreaterThanOrEqual(44);
      expect(link.width, `${link.label} link width`).toBeGreaterThan(44);
      expect(link.left, `${link.label} should stay inside the viewport`).toBeGreaterThanOrEqual(0);
      expect(link.right, `${link.label} should stay inside the viewport`).toBeLessThanOrEqual(390);
    }
  };

  const atRest = await measureChoices("main [data-primary-action] a, [data-testid='places-waitlist']");
  expect(atRest.overflow).toBeLessThanOrEqual(1);
  // The door and the request: both on screen, both a thumb's size.
  expect(atRest.links.length).toBe(2);
  expectTappable(atRest.links);
  await expect(page.getByTestId("places-waitlist")).toBeVisible();
  // The waitlist is one of the page's text links, never the browser's own.
  const waitlist = await page.getByTestId("places-waitlist").evaluate((link) => {
    const ink = document.createElement("span");
    ink.style.color = "var(--color-text)";
    link.parentElement!.append(ink);
    const expected = getComputedStyle(ink).color;
    ink.remove();
    return { color: getComputedStyle(link).color, expected, height: link.getBoundingClientRect().height };
  });
  expect(waitlist.color, "the waitlist reads in the page's ink").toBe(waitlist.expected);
  expect(waitlist.height, "waitlist link height").toBeGreaterThanOrEqual(44);

  // A city without listed prices is not a door, so the town lookup reaches it,
  // and every row it answers with is a thumb's target inside the viewport.
  await page.getByLabel("Find a town").fill("manch");
  const manchester = page
    .getByRole("list", { name: "Places" })
    .getByRole("link", { name: /Manchester/ })
    .first();
  await expect(manchester).toBeVisible({ timeout: 20_000 });
  const answered = await measureChoices(".placesCityLink");
  expect(answered.overflow).toBeLessThanOrEqual(1);
  expect(answered.links.length).toBeGreaterThanOrEqual(1);
  expectTappable(answered.links);
  // The town answer opens that city's map; the city panel still answers by URL.
  await expect(manchester).toHaveAttribute("href", /\/map\/manchester/);
  await page.goto("/places?city=manchester");
  await expect(
    page.getByRole("heading", { level: 1, name: "Manchester", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
});
