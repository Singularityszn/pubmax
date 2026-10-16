import { expect, test } from "@playwright/test";

for (const path of ["/tonight", "/out", "/pint-index", "/crawls"]) {
  test(`${path} has meaningful completed content without JavaScript`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(path === "/out" ? 0 : 1);
      if (path === "/tonight") {
        await expect(page.getByTestId("tonight-hyped-row").first()).toBeVisible();
        await expect(page.getByTestId("listings-skeleton")).toHaveCount(0);
        await expect(page.getByTestId("tonight-screen")).not.toHaveAttribute("data-listings-status", "idle");
      } else if (path === "/out") {
        await expect(page.getByTestId("listings-skeleton")).toHaveCount(0);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
      } else if (path === "/pint-index") {
        await expect(page.getByRole("heading", { name: "The Zone pint index" })).toBeVisible();
        await expect(page).toHaveTitle("London pint prices by borough and fare zone | PUBMAXX");
      } else {
        await expect(page.getByRole("heading", { name: "London pub crawl routes", exact: true })).toBeVisible();
        await expect(page.getByText("Victorian Soho", { exact: true })).toBeVisible();
        await expect(page.getByText("Camden Market crawl", { exact: true })).toBeVisible();
        await expect(page.getByText("Borough Market crawl", { exact: true })).toBeVisible();
        await expect(page.getByText("Fleet Street & the Writers", { exact: true })).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });
}

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`discovery pages hydrate at ${width}px in ${theme}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && /hydration|did not match|server rendered/i.test(message.text())) errors.push(message.text());
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.addInitScript((value) => {
        localStorage.setItem("pubmax-theme", value);
        localStorage.setItem("pubmax-tour-v1-done", "1");
      }, theme);
      for (const path of ["/today", "/tonight", "/out", "/pint-index", "/crawls"]) {
        expect((await page.goto(path))?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (path === "/tonight") await expect(page.getByTestId("listings-skeleton")).toHaveCount(0);
      }
      const href = await page.getByRole("link", { name: "Start a crawl", exact: true }).getAttribute("href");
      const arrival = new URL(href ?? "", "http://localhost");
      expect(arrival.pathname).toBe("/map");
      expect(arrival.searchParams.get("mode")).toBe("build");
      expect(arrival.searchParams.get("pubs")?.split(",")).toEqual([
        "venue-1ufn31x", "venue-1t8siin", "venue-xiesdn", "venue-phqazo", "venue-15i2wst",
      ]);
      expect(errors).toEqual([]);
    });
  }
}
