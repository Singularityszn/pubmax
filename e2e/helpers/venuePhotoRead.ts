import type { Page } from "@playwright/test";

import type { VenuePhotoPage } from "@/lib/venuePhotos";

export async function installVenuePhotoRead(
  page: Page,
  content: "empty" | "populated",
): Promise<void> {
  await page.route("**/api/venue-photos?**", async (route) => {
    const venueId = new URL(route.request().url()).searchParams.get("venueId");
    const body: VenuePhotoPage = {
      status: "ready",
      photos: content === "empty" ? [] : [{
        id: "33333333-3333-4333-8333-000000000001",
        venueId,
        wallCategory: "pub",
        placeLabel: null,
        url: "/icon-192.png",
        drinkCategory: null,
        caption: "A photo shared by a pub visitor.",
        width: 192,
        height: 192,
        createdAt: "2026-11-19T19:00:00.000Z",
        author: { handle: "riverwalker" },
        ownedByViewer: false,
      }],
      nextCursor: null,
    };
    await route.fulfill({ json: body });
  });
}
