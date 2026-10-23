import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`London journal and requested film at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((value) => localStorage.setItem("pubmax-theme", value), theme);
      const mediaRequests: string[] = [];
      page.on("request", (request) => {
        if (request.url().endsWith("/london.mp4")) mediaRequests.push(request.url());
      });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "What a pint costs, pub by pub." })).toBeVisible();
      const journal = page.getByRole("region", { name: "Around London" });
      await journal.scrollIntoViewIfNeeded();
      await expect(journal.getByRole("link")).toHaveCount(4);
      await expect(journal.getByRole("link", { name: /The Crown Tavern/ }))
        .toHaveAttribute("href", "/map?sel=venue-13sug69");
      await expect(journal.locator("img").first()).toBeVisible();
      const film = page.getByRole("region", { name: "London, day to night" });
      const play = film.getByRole("button", { name: /Play London film/ });
      await play.scrollIntoViewIfNeeded();
      await expect(play).toBeVisible();
      await expect(film.locator("video")).toHaveCount(0);
      expect(mediaRequests).toEqual([]);
      const frame = await film.locator(".lpFilmFrame").boundingBox();
      await play.focus();
      await expect(async () => {
        if (await play.isVisible()) await play.press("Enter");
        await expect(film.locator("video")).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      const video = film.locator("video");
      await expect(video).toBeFocused();
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
      expect(await video.evaluate((element: HTMLVideoElement) => element.duration)).toBeCloseTo(12, 1);
      expect(await video.evaluate((element: HTMLVideoElement) => element.controls && !element.loop)).toBe(true);
      expect(mediaRequests.length).toBeGreaterThan(0);
      const playingFrame = await film.locator(".lpFilmFrame").boundingBox();
      expect(playingFrame?.height).toBeCloseTo(frame?.height ?? 0, 0);
      await video.evaluate((element: HTMLVideoElement) => element.pause());
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

test("film failure preserves an accessible retry", async ({ page }) => {
  await page.route("**/landing/london-film/london.mp4", (route) => route.abort());
  await page.goto("/");
  const film = page.getByRole("region", { name: "London, day to night" });
  await film.getByRole("button", { name: /Play London film/ }).click();
  await expect(film.getByRole("status")).toContainText("The film could not load");
  await expect(film.getByRole("button", { name: /Try the film again/ })).toBeVisible();
});

test("optional explanations stay available by keyboard", async ({ page }) => {
  await page.goto("/about");
  const press = page.locator("details").filter({ has: page.getByText("Press details and downloads", { exact: true }) });
  await expect(press).not.toHaveAttribute("open");
  await press.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(press).toHaveAttribute("open");
  await expect(press.getByRole("link", { name: "PNG (512px)" })).toBeVisible();
});
