const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const STYLE = JSON.stringify({ version: 8, sources: { basemap: { type: "raster", tiles: ["https://tiles.openfreemap.org/__empty/{z}/{x}/{y}.png"], tileSize: 256 } },
  layers: [{ id: "background", type: "background", paint: { "background-color": "#111111" } }, { id: "basemap", type: "raster", source: "basemap" }] });
// Same deterministic basemap as e2e/helpers/mapNetworkFixtures.ts: the sandbox cannot reach the tile CDN.
export async function stubBasemap(page) {
  const empty = (r) => r.fulfill({ status: 200, contentType: "application/x-protobuf", body: Buffer.alloc(0) });
  await page.route("**/*.mvt*", empty);
  await page.route("**/*.pbf*", empty);
  await page.route("**/__empty/**/*.png*", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  const style = (r) => r.fulfill({ status: 200, contentType: "application/json", body: STYLE });
  await page.route(/^https:\/\/tiles\.openfreemap\.org\/styles\/(?:dark|positron)\/?$/, style);
  await page.route(/^https:\/\/basemaps\.cartocdn\.com\/gl\/(?:dark-matter|positron)-gl-style\/style\.json$/, style);
}
