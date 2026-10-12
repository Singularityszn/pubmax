import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    for (const fallback of [false, true]) {
      test(`gallery photo credit clears badges at ${width} ${theme} ${fallback ? "WebP fallback" : "AVIF"}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.addInitScript((value) => {
          localStorage.setItem("pubmax-theme", value);
          localStorage.setItem("pubmax-tour-v1-done", "1");
          sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
        }, theme);

        const imageTypes = new Map<string, string>();
        page.on("response", (imageResponse) => {
          if (new URL(imageResponse.url()).pathname === "/api/image-proxy") {
            imageTypes.set(imageResponse.url(), imageResponse.headers()["content-type"] ?? "");
          }
        });
        const failedSources = new Set<string>();
        if (fallback) {
          await page.route("**/api/image-proxy?**", async (route) => {
            const url = new URL(route.request().url());
            if (url.searchParams.get("f") === "avif") {
              failedSources.add(url.searchParams.get("src") ?? "");
              await route.fulfill({
                status: 200,
                contentType: "image/avif",
                body: "corrupt AVIF",
              });
            } else {
              await route.continue();
            }
          });
        }

        const response = await page.goto("/pubs");
        expect(response?.status()).toBe(200);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const card = page.locator(".pubsCard").filter({
          has: page.locator(".pubsCardPhoto"),
        }).first();
        await card.scrollIntoViewIfNeeded();
        const photo = card.locator(".venueImage__img");
        await expect(photo).toBeVisible();
        await expect.poll(() => photo.evaluate((image: HTMLImageElement) =>
          image.complete && image.naturalWidth > 0,
        )).toBe(true);
        await photo.evaluate((image: HTMLImageElement) => image.decode());
        const source = new URL(await photo.evaluate((image: HTMLImageElement) => image.currentSrc));
        expect(imageTypes.get(source.href), "the decoded response uses the expected image format")
          .toMatch(fallback ? /^image\/webp(?:;|$)/ : /^image\/avif(?:;|$)/);
        if (fallback) {
          expect(source.searchParams.get("f")).not.toBe("avif");
          expect(source.searchParams.get("src")).toBeTruthy();
          expect(failedSources.has(source.searchParams.get("src")!)).toBe(true);
          await expect(card.locator("picture source[type='image/avif']")).toHaveCount(0);
        } else {
          expect(source.searchParams.get("f")).toBe("avif");
        }

        const credit = card.locator(".venueImage__provenance");
        await expect(credit).toBeVisible();
        await expect(credit).toHaveText("Photo: pub website");
        await page.evaluate(async () => { await document.fonts.ready; });
        const geometry = await card.evaluate((element) => {
          const rect = (selector: string) => {
            const box = element.querySelector(selector)!.getBoundingClientRect();
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
          };
          return {
            art: rect(".pubsCardArt"),
            photo: rect(".pubsCardPhoto"),
            body: rect(".pubsCardBody"),
            metadata: Array.from(element.querySelectorAll(".pubsCardMeta > *"), (label) => {
              const box = label.getBoundingClientRect();
              const hit = document.elementFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2,
              );
              return {
                text: label.textContent,
                top: box.top,
                bottom: box.bottom,
                ownsCenter: hit !== null && label.contains(hit),
              };
            }),
            credit: rect(".venueImage__provenance"),
            shelf: rect(".pubsCardShelf"),
            label: rect(".pubsCardArtLabel"),
          };
        });
        await testInfo.attach("card-metadata-clearance", {
          body: JSON.stringify(geometry),
          contentType: "application/json",
        });
        expect(geometry.art.bottom, "artwork clears the card body").toBeLessThanOrEqual(geometry.body.top);
        expect(geometry.photo.bottom, "the photo stays inside the artwork").toBeLessThanOrEqual(geometry.art.bottom);
        expect(geometry.metadata.length, "the card has visible metadata").toBeGreaterThan(0);
        for (const label of geometry.metadata) {
          expect(label.top, `${label.text} clears the artwork`).toBeGreaterThanOrEqual(geometry.art.bottom);
          expect(label.bottom).toBeGreaterThan(label.top);
          expect(label.ownsCenter, `${label.text} owns its center hit`).toBe(true);
        }
        expect(geometry.credit.bottom + 4, "credit clears the drink shelf").toBeLessThanOrEqual(geometry.shelf.top);
        expect(geometry.credit.right + 4, "credit clears the upper-right label").toBeLessThanOrEqual(geometry.label.left);
        for (const bounds of [geometry.art, geometry.photo]) {
          expect(geometry.credit.left).toBeGreaterThanOrEqual(bounds.left);
          expect(geometry.credit.right).toBeLessThanOrEqual(bounds.right);
          expect(geometry.credit.top).toBeGreaterThanOrEqual(bounds.top);
          expect(geometry.credit.bottom).toBeLessThanOrEqual(bounds.bottom);
        }
        await testInfo.attach("photo-credit-clearance", {
          body: JSON.stringify(geometry),
          contentType: "application/json",
        });
        await testInfo.attach("visible-photo-credit", {
          body: await card.screenshot(),
          contentType: "image/png",
        });
      });
    }
  }
}
