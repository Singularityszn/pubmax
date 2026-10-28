import { describe, expect, it } from "vitest";
import { createMapCameraOwnership } from "@/lib/mapCameraProvenance";

const home = { center: [-0.0916478, 51.5286] as [number, number], zoom: 15, pitch: 38, bearing: 0 };
const elsewhere = { ...home, center: [-0.134, 51.511] as [number, number] };

describe("camera persistence ownership", () => {
  it("never grants a location or an automatic camera update permission to persist", () => {
    const camera = createMapCameraOwnership();
    camera.settle(home);
    expect(camera.capture(home)).toBeNull();
    camera.beginPublicPlace(elsewhere.center);
    camera.settle(elsewhere);
    expect(camera.capture(elsewhere)?.provenance.source).toBe("public-place");
    camera.settle(home);
    expect(camera.capture(home)).toBeNull();
  });

  it("waits for the selected public place before granting its settled viewport", () => {
    const camera = createMapCameraOwnership();
    camera.beginPublicPlace(elsewhere.center);
    camera.settle(home);
    expect(camera.capture(home)).toBeNull();
    camera.settle(elsewhere);
    expect(camera.capture(elsewhere)?.provenance.source).toBe("public-place");
  });

  it("invalidates a queued save and an outstanding restore before location resolves", () => {
    const camera = createMapCameraOwnership();
    camera.beginPublicPlace(home.center);
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
    camera.beginPublicPlace(home.center);
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
    camera.exposeLocation();
    camera.beginPublicPlace(elsewhere.center);
    camera.settle(elsewhere);
    expect(camera.capture(elsewhere)).toBeNull();
  });

});
