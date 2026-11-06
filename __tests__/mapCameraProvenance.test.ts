import { describe, expect, it } from "vitest";
import { createMapCameraOwnership } from "@/lib/mapCameraProvenance";

const home = { center: [-0.0916478, 51.5286] as [number, number], zoom: 15, pitch: 38, bearing: 0 };
const elsewhere = { ...home, center: [-0.134, 51.511] as [number, number] };

describe("camera persistence ownership", () => {
  // A named-area link can finish moving before venue loading applies the
  // explicit choice. Saving must not depend on another camera event.
  it("authorises an already settled public-area camera without another move", () => {
    const camera = createMapCameraOwnership();
    camera.settle(elsewhere);
    camera.beginPublicPlace(elsewhere.center, elsewhere.zoom);
    expect(camera.capture(elsewhere)?.provenance.source).toBe("public-place");
  });

  it("waits for the requested zoom when choosing the current public-area centre", () => {
    const camera = createMapCameraOwnership();
    camera.settle(elsewhere);
    camera.beginPublicPlace(elsewhere.center, 14);
    expect(camera.capture(elsewhere)).toBeNull();
    const chosen = { ...elsewhere, zoom: 14 };
    camera.settle(chosen);
    expect(camera.capture(chosen)?.provenance.source).toBe("public-place");
  });

  it("keeps a public choice through MapLibre coordinate rounding only", () => {
    const camera = createMapCameraOwnership();
    const chosen = { ...elsewhere, center: [-0.134, 51.511] as [number, number] };
    camera.settle(chosen);
    camera.beginPublicPlace(chosen.center, chosen.zoom);
    // MapLibre's Mercator round trip reports these values for the same view.
    const reported = { ...chosen, center: [-0.13400000000001455, 51.511000000000024] as [number, number], pitch: 38.00000000000001 };
    camera.settle(reported);
    expect(camera.capture(reported)?.provenance.source).toBe("public-place");
    camera.settle({ ...reported, center: [-0.134001, 51.511] });
    expect(camera.capture(reported)).toBeNull();
  });

  it("never grants a location or an automatic camera update permission to persist", () => {
    const camera = createMapCameraOwnership();
    camera.settle(home);
    expect(camera.capture(home)).toBeNull();
    camera.beginPublicPlace(elsewhere.center, elsewhere.zoom);
    camera.settle(elsewhere);
    expect(camera.capture(elsewhere)?.provenance.source).toBe("public-place");
    camera.settle(home);
    expect(camera.capture(home)).toBeNull();
  });

  it("waits for the selected public place before granting its settled viewport", () => {
    const camera = createMapCameraOwnership();
    camera.beginPublicPlace(elsewhere.center, elsewhere.zoom);
    camera.settle(home);
    expect(camera.capture(home)).toBeNull();
    camera.settle(elsewhere);
    expect(camera.capture(elsewhere)?.provenance.source).toBe("public-place");
  });

  it("invalidates a queued save and an outstanding restore before location resolves", () => {
    const camera = createMapCameraOwnership();
    camera.beginPublicPlace(home.center, home.zoom);
    camera.settle(home);
    const save = camera.capture(home)!;
    const restore = camera.checkpoint();
    camera.exposeLocation();
    expect(save.isCurrent()).toBe(false);
    expect(restore()).toBe(false);
    camera.settle(home);
    expect(camera.capture(home)).toBeNull();
  });

  it("does not revive pending intent after the map closes", () => {
    const camera = createMapCameraOwnership();
    camera.beginPublicPlace(home.center, home.zoom);
    camera.detach();
    camera.settle(home);
    expect(camera.capture(home)).toBeNull();
  });

  it("rejects an unmarked restored camera but preserves a marked explicit choice", () => {
    expect(createMapCameraOwnership({ viewport: home }).capture(home)).toBeNull();
    expect(createMapCameraOwnership({
      viewport: home, cameraProvenance: { version: 1, source: "public-place" },
    }).capture(home)?.provenance.source).toBe("public-place");
  });
  it("keeps location exposure private even after later public-place choices", () => {
    const camera = createMapCameraOwnership();
    camera.settle(elsewhere);
    camera.exposeLocation();
    camera.beginPublicPlace(elsewhere.center, elsewhere.zoom);
    expect(camera.capture(elsewhere)).toBeNull();
    camera.settle(elsewhere);
    expect(camera.capture(elsewhere)).toBeNull();
  });

});
