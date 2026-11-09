import { afterEach, describe, expect, it, vi } from "vitest";

import { MAP_STYLES } from "@/lib/mapBasemapStyles";
import { MAPLIBRE_WORKER_URL } from "@/lib/maplibreWorkerAssets";

const TILE_JSON = "https://tiles.openfreemap.org/planet";

function styleResponse(): Response {
  return new Response(
    JSON.stringify({
      sources: {
        openmaptiles: { type: "vector", url: TILE_JSON },
        ne2_shaded: { type: "raster", tiles: ["https://example.test/{z}/{x}/{y}.png"] },
      },
    }),
  );
}

async function loadWarm(theme: "dark" | "light", fetchImpl: (url: string) => Promise<Response>) {
  vi.resetModules();
  vi.stubGlobal("document", { documentElement: { dataset: { theme } } });
  const fetchSpy = vi.fn(fetchImpl);
  vi.stubGlobal("fetch", fetchSpy);
  const { warmMapEngine } = await import("@/lib/mapEngineWarm");
  return { warmMapEngine, fetchSpy };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("warmMapEngine", () => {
  it("asks once for the worker, the theme's style and the style's TileJSON", async () => {
    const { warmMapEngine, fetchSpy } = await loadWarm("dark", async (url) =>
      url === MAP_STYLES.dark ? styleResponse() : new Response("x"),
    );

    warmMapEngine();
    warmMapEngine();
    await settle();
    await settle();

    expect(fetchSpy.mock.calls.map(([url]) => url).sort()).toEqual(
      [MAPLIBRE_WORKER_URL, MAP_STYLES.dark, TILE_JSON].sort(),
    );
  });

  it("follows the light theme to its own style", async () => {
    const { warmMapEngine, fetchSpy } = await loadWarm("light", async (url) =>
      url === MAP_STYLES.light ? styleResponse() : new Response("x"),
    );

    warmMapEngine();
    await settle();

    expect(fetchSpy.mock.calls.map(([url]) => url)).toContain(MAP_STYLES.light);
    expect(fetchSpy.mock.calls.map(([url]) => url)).not.toContain(MAP_STYLES.dark);
  });

  it("swallows a failed or refused download", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { warmMapEngine, fetchSpy } = await loadWarm("dark", async (url) => {
      if (url === MAPLIBRE_WORKER_URL) throw new TypeError("offline");
      return new Response("nope", { status: 503 });
    });

    expect(() => warmMapEngine()).not.toThrow();
    await settle();
    await settle();
    process.off("unhandledRejection", unhandled);

    expect(unhandled).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.map(([url]) => url)).not.toContain(TILE_JSON);
  });
});
