import type { Page, Route } from "@playwright/test";

import type { BasemapProvider } from "@/components/map/canvas/tokens";

const EMPTY_RASTER_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/**
 * The credit each basemap's live style ships, copied from the providers on
 * 2 Nov 2026: OpenFreeMap's arrives in the TileJSON of its `planet` source,
 * CARTO's in the style itself. MapLibre's own credit control
 * (`.maplibregl-ctrl-attrib`) prints whatever the loaded style credits, so a
 * fixture style with no credit drew a map credit no reader ever sees. Each
 * fixture style now carries the credit of the provider whose URL it answers.
 * Fence: __tests__/e2eBasemapFixtureCredits.test.ts holds the OpenFreeMap line
 * to the one lib/mapOpeningSnapshot.json last read off the live style.
 */
export const LIVE_BASEMAP_CREDITS: Record<BasemapProvider, string> = {
  openfreemap:
    '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
    '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
    'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  carto:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
    '&copy; <a href="https://carto.com/about-carto/">CARTO</a>',
};

function emptyStyle(stallSecondaryRaster: boolean, provider: BasemapProvider) {
  return JSON.stringify({
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: ["https://tiles.openfreemap.org/__empty/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: LIVE_BASEMAP_CREDITS[provider],
      },
      ...(stallSecondaryRaster
        ? {
            pending: {
              type: "raster",
              tiles: [
                "https://tiles.openfreemap.org/__pending/{z}/{x}/{y}.png",
              ],
              tileSize: 256,
            },
          }
        : {}),
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#111111" },
      },
      { id: "basemap", type: "raster", source: "basemap" },
      ...(stallSecondaryRaster
        ? [
            {
              id: "pending",
              type: "raster",
              source: "pending",
              paint: { "raster-opacity": 0.01 },
            },
          ]
        : []),
    ],
  });
}

export async function installDeterministicMapBasemap(
  page: Page,
  options: {
    primaryRasterDelayMs?: number;
    secondaryRasterDelayMs?: number;
    styleDelayMs?: number;
    stallSecondaryRaster?: boolean;
    /**
     * Abort this many primary raster tile requests before serving any. A
     * transient basemap outage: the reader's next attempt succeeds, so the
     * map must recover with nothing on screen about it.
     */
    failPrimaryRasterRequests?: number;
    /** Refuse every style request, primary and fallback alike. */
    failStyle?: boolean;
  } = {},
): Promise<void> {
  const emptyVectorTile = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-protobuf",
      body: Buffer.alloc(0),
    });
  let primaryRasterFailuresLeft = options.failPrimaryRasterRequests ?? 0;
  const fulfillStyle = (provider: BasemapProvider) => async (route: Route) => {
    if (options.failStyle) {
      await route.abort("failed");
      return;
    }
    if (options.styleDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.styleDelayMs));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: emptyStyle(options.stallSecondaryRaster ?? false, provider),
    });
  };

  await page.route("**/*.mvt*", emptyVectorTile);
  await page.route("**/*.pbf*", emptyVectorTile);
  await page.route("**/__empty/**/*.png*", async (route) => {
    if (primaryRasterFailuresLeft > 0) {
      primaryRasterFailuresLeft -= 1;
      await route.abort("failed");
      return;
    }
    if (options.primaryRasterDelayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, options.primaryRasterDelayMs),
      );
    }
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: EMPTY_RASTER_TILE,
    });
  });
  if (options.stallSecondaryRaster) {
    await page.route("**/__pending/**/*.png*", async (route) => {
      await new Promise((resolve) =>
        setTimeout(resolve, options.secondaryRasterDelayMs ?? 20_000),
      );
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: EMPTY_RASTER_TILE,
      });
    });
  }
  await page.route(
    /^https:\/\/tiles\.openfreemap\.org\/styles\/(?:dark|positron)\/?$/,
    fulfillStyle("openfreemap"),
  );
  await page.route(
    /^https:\/\/basemaps\.cartocdn\.com\/gl\/(?:dark-matter|positron)-gl-style\/style\.json$/,
    fulfillStyle("carto"),
  );
}
