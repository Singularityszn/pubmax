import type { Page, Route } from "@playwright/test";

const EMPTY_RASTER_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function emptyStyle(stallSecondaryRaster: boolean) {
  return JSON.stringify({
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: ["https://tiles.openfreemap.org/__empty/{z}/{x}/{y}.png"],
        tileSize: 256,
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
): Promise<{ failedPrimaryRaster: number; servedPrimaryRaster: number }> {
  const requests = { failedPrimaryRaster: 0, servedPrimaryRaster: 0 };
  const emptyVectorTile = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-protobuf",
      body: Buffer.alloc(0),
    });
  let primaryRasterFailuresLeft = options.failPrimaryRasterRequests ?? 0;
  const fulfillStyle = async (route: Route) => {
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
      body: emptyStyle(options.stallSecondaryRaster ?? false),
    });
  };

  await page.route("**/*.mvt*", emptyVectorTile);
  await page.route("**/*.pbf*", emptyVectorTile);
  await page.route("**/__empty/**/*.png", async (route) => {
    if (primaryRasterFailuresLeft > 0) {
      primaryRasterFailuresLeft -= 1;
      await route.abort("failed");
      requests.failedPrimaryRaster += 1;
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
    requests.servedPrimaryRaster += 1;
  });
  if (options.stallSecondaryRaster) {
    await page.route("**/__pending/**/*.png", async (route) => {
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
    fulfillStyle,
  );
  await page.route(
    /^https:\/\/basemaps\.cartocdn\.com\/gl\/(?:dark-matter|positron)-gl-style\/style\.json$/,
    fulfillStyle,
  );
  return requests;
}
