import { expect, test, type Page } from "@playwright/test";

import {
  DOG_OF_THE_WEEK_EMPTY_LINE,
  DOG_OF_THE_WEEK_PATH,
  DOG_OF_THE_WEEK_TITLE,
} from "../lib/dogOfTheWeek";
import { installAuthDoubles, seedSignedIn, stubSocialAuthProviders } from "./helpers/authDoubles";

// Dog of the week (round 5 F7) and the Dog category on the photo wall.
//
// KEYLESS: the wall store is in memory and empty on a fresh server, and no
// spec may post a photo just to fill it, so this holds the no-dog state. The
// page says its one empty line with no handle, no photo and no broken image,
// and Discover carries no card for it. The filled page (a dog, its pub, its
// uploader) is held by __tests__/dogOfTheWeek.test.tsx.
//
// The wall's upload door is opened signed in through the auth doubles, the
// way every signed-in browser spec reaches a composer.

const WIDTHS = [390, 1280] as const;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const url = message.location().url;
    const keylessAuthNoise =
      url.includes("pubmaxx-e2e.supabase.co") ||
      text.includes("wss://pubmaxx-e2e.supabase.co/realtime/");
    if (!keylessAuthNoise) errors.push(text);
  });
  return errors;
}

/** Images the browser could not paint: loaded, with nothing to draw. */
function brokenImages(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.images]
      .filter((img) => img.complete && img.naturalWidth === 0)
      .map((img) => img.currentSrc || img.src),
  );
}

test.beforeEach(async ({ page }) => {
  await stubSocialAuthProviders(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    });

    test("the page with no dog says the empty line, and shows no handle and no photo", async ({
      page,
    }) => {
      const errors = watchErrors(page);
      const response = await page.goto(DOG_OF_THE_WEEK_PATH);
      expect(response?.status()).toBe(200);

      const main = page.locator("main#main");
      await expect(
        main.getByRole("heading", { name: DOG_OF_THE_WEEK_TITLE, level: 1 }),
      ).toBeVisible();
      await expect(main.locator(".dogOfTheWeekEmpty")).toHaveText(DOG_OF_THE_WEEK_EMPTY_LINE);
      await expect(main.getByRole("link", { name: "See the photo wall" })).toHaveAttribute(
        "href",
        "/wall",
      );

      await expect(main.locator(".dogOfTheWeekFigure")).toHaveCount(0);
      await expect(main.locator("img")).toHaveCount(0);
      await expect(main.getByText(/Photo by @/)).toHaveCount(0);
      await expect(main.getByText(/@\w/)).toHaveCount(0);
      expect(await brokenImages(page)).toEqual([]);

      expect(errors).toEqual([]);
    });

    test("Discover carries no Dog of the week card when there is no dog", async ({ page }) => {
      const errors = watchErrors(page);
      const dogRead = page.waitForResponse(
        (response) =>
          response.url().includes("/api/drink-wall") &&
          new URL(response.url()).searchParams.get("category") === "dog",
      );
      const response = await page.goto("/discover");
      expect(response?.status()).toBe(200);

      // The card decides after its one wall read lands; wait for that read.
      const read = await dogRead;
      expect(read.ok()).toBe(true);
      const body = (await read.json()) as { photos?: unknown[] };
      expect(body.photos ?? []).toEqual([]);

      await expect(page.locator(".dogOfTheWeekCard")).toHaveCount(0);
      await expect(page.locator(`a[href="${DOG_OF_THE_WEEK_PATH}"]`)).toHaveCount(0);
      await expect(page.getByText(DOG_OF_THE_WEEK_TITLE, { exact: true })).toHaveCount(0);

      expect(errors).toEqual([]);
    });

    test("the wall lists Dog as a photo type, and its upload door offers Dog", async ({ page }) => {
      // Signed in through doubles, the real keyless routes refuse the fake
      // bearer (401/403 in the console), so this test holds page errors only,
      // as the signed-in tests in e2e/venue-photo-wall.spec.ts do.
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await installAuthDoubles(page);
      await seedSignedIn(page, "A");

      const response = await page.goto("/wall");
      expect(response?.status()).toBe(200);

      const types = page.getByRole("group", { name: "Photo type" });
      await expect(types.getByRole("button")).toHaveText(["All", "Pint", "London", "Pub", "Dog"]);

      // The door is painted once the session is known: retry the tap until
      // the composer's category list is up.
      const addPhoto = page.getByRole("button", { name: "Add a photo" }).first();
      const categories = page
        .locator(".venuePhotoComposer fieldset")
        .filter({ has: page.locator("legend", { hasText: /^Category$/ }) });
      const tryAgain = page.getByRole("button", { name: "Try again" });
      await expect(async () => {
        // KNOWN (reported, 30 Oct 2026): a cold signed-in load aborts the
        // wall's first read before it reaches the network, and the wall shows
        // its "could not read" line. Its own Try again is the reader's way
        // on, so the spec takes it too, rather than assert past it.
        if (await tryAgain.isVisible()) await tryAgain.click({ timeout: 1_000 });
        await addPhoto.click({ timeout: 1_000 });
        await expect(categories).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });

      await expect(categories.getByRole("button")).toHaveText(["Pint", "London", "Pub", "Dog"]);
      const dog = categories.getByRole("button", { name: "Dog", exact: true });
      await dog.click();
      await expect(dog).toHaveAttribute("aria-pressed", "true");
      // A dog photo names its pub: the pub field drops "(optional)".
      await expect(page.locator(".venuePhotoComposer .venuePhotoComposerLegend", { hasText: /^Pub$/ })).toBeVisible();

      expect(errors).toEqual([]);
    });
  });
}
