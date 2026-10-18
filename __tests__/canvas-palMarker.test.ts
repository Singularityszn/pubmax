// @vitest-environment jsdom
import type * as maplibregl from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markerHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    options: { element: HTMLElement; anchor?: string; offset?: [number, number] };
    lngLat: [number, number] | null;
    remove: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("maplibre-gl", () => ({
  Marker: class {
    remove = vi.fn();

    lngLat: [number, number] | null = null;

    constructor(public options: { element: HTMLElement; anchor?: string; offset?: [number, number] }) {
      markerHarness.instances.push(this);
    }

    setLngLat(lngLat: [number, number]) {
      this.lngLat = lngLat;
      return this;
    }

    addTo() {
      return this;
    }
  },
}));

import { createPalMapMarker, palMarkerElement } from "@/components/map/canvas/palMarker";
import type { PubPal } from "@/lib/pubPal";

const map = {} as maplibregl.Map;

function pal(overrides: Partial<PubPal> = {}): PubPal {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    ownerId: "owner",
    name: "Ada",
    adultAttestedAt: now,
    appearance: { species: "robin", signalAffinity: "pint", material: "hologram", accessory: "none" },
    personality: { energy: 50, playfulness: 50, storytelling: 50, relationship: "guide" },
    voice: { id: "warm" },
    muted: false,
    hidden: false,
    proposalPreferences: {},
    masteryPoints: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as PubPal;
}

function store(value: unknown) {
  window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(value));
}

beforeEach(() => {
  markerHarness.instances.length = 0;
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the Pal on the map", () => {
  it("makes no marker without a stored Pal, or for one the reader hid", () => {
    createPalMapMarker(map).perch([-0.1, 51.5]);
    store(pal({ hidden: true }));
    createPalMapMarker(map).perch([-0.1, 51.5]);
    store({ id: "pal-e2e", appearance: {} });
    createPalMapMarker(map).perch([-0.1, 51.5]);
    expect(markerHarness.instances).toHaveLength(0);
  });

  it("is a decorative avatar held by the Pal genome", () => {
    const element = palMarkerElement(pal())!;
    expect(element.getAttribute("aria-hidden")).toBe("true");
    expect(element.querySelectorAll("a, button")).toHaveLength(0);
    const image = element.querySelector("img")!;
    expect(image.getAttribute("src")).toMatch(/avatar.*64.*\.webp$/);
    expect(image.alt).toBe("");
    const body = element.querySelector<HTMLElement>(".palMapMarkerBody")!;
    expect(body.style.getPropertyValue("--genome-zoom")).not.toBe("");
  });

  it("sleeps with a muted Pal", () => {
    expect(palMarkerElement(pal({ muted: true }))!.dataset.palState).toBe("sleeping");
    expect(palMarkerElement(pal())!.dataset.palState).toBeUndefined();
  });

  it("perches beside the pin, hops to a new one, and steps off with no selection", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.perch([-0.1, 51.5]);
    expect(markerHarness.instances).toHaveLength(1);
    const [instance] = markerHarness.instances;
    expect(instance!.options.anchor).toBe("bottom-left");
    expect(instance!.lngLat).toEqual([-0.1, 51.5]);
    expect(instance!.options.element.classList.contains("isLanding")).toBe(true);

    marker.perch([-0.12, 51.51]);
    expect(markerHarness.instances).toHaveLength(1);
    expect(instance!.lngLat).toEqual([-0.12, 51.51]);

    marker.perch(null);
    expect(instance!.remove).toHaveBeenCalledTimes(1);
    marker.perch([-0.12, 51.51]);
    expect(markerHarness.instances).toHaveLength(2);
    marker.destroy();
    expect(markerHarness.instances[1]!.remove).toHaveBeenCalledTimes(1);
  });
});
