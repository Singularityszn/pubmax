import type { Page, Route } from "@playwright/test";

const EMPTY_RASTER_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const EMPTY_STYLE = JSON.stringify({
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: ["https://tiles.openfreemap.org/__empty/{z}/{x}/{y}.png"],
      tileSize: 256,
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#111111" } },
    { id: "basemap", type: "raster", source: "basemap" },
  ],
});

export async function installDeterministicMapBasemap(
  page: Page,
  options: { styleDelayMs?: number } = {},
): Promise<void> {
  const emptyVectorTile = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-protobuf",
      body: Buffer.alloc(0),
    });
  const fulfillStyle = async (route: Route) => {
    if (options.styleDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.styleDelayMs));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: EMPTY_STYLE,
    });
  };

  await page.route("**/*.mvt*", emptyVectorTile);
  await page.route("**/*.pbf*", emptyVectorTile);
  await page.route("**/__empty/**/*.png", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: EMPTY_RASTER_TILE,
    }),
  );
  await page.route(
    /^https:\/\/tiles\.openfreemap\.org\/styles\/(?:dark|positron)\/?$/,
    fulfillStyle,
  );
  await page.route(
    /^https:\/\/basemaps\.cartocdn\.com\/gl\/(?:dark-matter|positron)-gl-style\/style\.json$/,
    fulfillStyle,
  );
}
