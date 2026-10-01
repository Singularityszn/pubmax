import { beforeEach, describe, expect, it, vi } from "vitest";

const { haversineMeters } = vi.hoisted(() => ({ haversineMeters: vi.fn() }));

vi.mock("@/lib/greatCircle.mjs", () => ({ haversineMeters }));

import { coarsenedViewerAccuracy } from "@/lib/geo";

const point = { lat: 51.512345, lng: -0.123456 };
const reduced = { lat: 51.512, lng: -0.123 };

beforeEach(() => {
  haversineMeters.mockReset();
});

describe("friend location accuracy uses shared distance authority", () => {
  it("includes the shared distance leaf's displacement in the published radius", () => {
    haversineMeters.mockReturnValue(77.4);

    expect(coarsenedViewerAccuracy(point, reduced, 90)).toBe(168);
  });

  it("keeps the privacy floor when reported accuracy and displacement are smaller", () => {
    haversineMeters.mockReturnValue(1.2);

    expect(coarsenedViewerAccuracy(point, reduced, 9)).toBe(110);
  });

  it("rounds the combined radius upward after adding displacement", () => {
    haversineMeters.mockReturnValue(0.4);

    expect(coarsenedViewerAccuracy(point, reduced, 180.2)).toBe(181);
  });
});
