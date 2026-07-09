import type { PoiCategory } from "@/lib/pois";
import { POI_CATEGORY_META } from "@/lib/pois";

// UI toggle groups for the map POI chrome. Tube + Rail share one "Transit"
// control so the strip stays scannable; symbols on the map stay distinct.

export type PoiToggleGroupId =
  | "transit"
  | "bus"
  | "river"
  | "park"
  | "garden"
  | "market"
  | "historic"
  | "viewpoint"
  | "sight";

export type PoiToggleGroup = {
  id: PoiToggleGroupId;
  label: string;
  color: string;
  categories: readonly PoiCategory[];
};

export const POI_TOGGLE_GROUPS: readonly PoiToggleGroup[] = [
  {
    id: "transit",
    label: "Transit",
    color: POI_CATEGORY_META.tube.color,
    categories: ["tube", "rail"],
  },
  { id: "bus", label: "Bus", color: POI_CATEGORY_META.bus.color, categories: ["bus"] },
  {
    id: "river",
    label: "River",
    color: POI_CATEGORY_META.river.color,
    categories: ["river"],
  },
  {
    id: "park",
    label: "Parks",
    color: POI_CATEGORY_META.park.color,
    categories: ["park"],
  },
  {
    id: "garden",
    label: "Gardens",
    color: POI_CATEGORY_META.garden.color,
    categories: ["garden"],
  },
  {
    id: "market",
    label: "Markets",
    color: POI_CATEGORY_META.market.color,
    categories: ["market"],
  },
  {
    id: "historic",
    label: "Historic",
    color: POI_CATEGORY_META.historic.color,
    categories: ["historic"],
  },
  {
    id: "viewpoint",
    label: "Views",
    color: POI_CATEGORY_META.viewpoint.color,
    categories: ["viewpoint"],
  },
  {
    id: "sight",
    label: "Sights",
    color: POI_CATEGORY_META.sight.color,
    categories: ["sight"],
  },
];

// Desktop default: Transit + Parks + Sights on; denser ambient categories off
// until the viewer opts in (reduces first-paint dot soup).
export function defaultPoiHidden(): Record<PoiCategory, boolean> {
  return {
    tube: false,
    rail: false,
    bus: true,
    river: true,
    park: false,
    garden: true,
    market: true,
    historic: true,
    viewpoint: true,
    sight: false,
  };
}

// Mobile default: every POI layer hidden so the map mid-field stays clean.
// Viewers opt in via the corner Layers control.
export function defaultPoiHiddenMobile(): Record<PoiCategory, boolean> {
  return {
    tube: true,
    rail: true,
    bus: true,
    river: true,
    park: true,
    garden: true,
    market: true,
    historic: true,
    viewpoint: true,
    sight: true,
  };
}

export function isMobileMapViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
}

export function defaultPoiHiddenForViewport(): Record<PoiCategory, boolean> {
  return isMobileMapViewport() ? defaultPoiHiddenMobile() : defaultPoiHidden();
}

export function isPoiGroupOn(
  hidden: Record<PoiCategory, boolean>,
  group: PoiToggleGroup,
): boolean {
  return group.categories.every((category) => !hidden[category]);
}

export function togglePoiGroup(
  hidden: Record<PoiCategory, boolean>,
  group: PoiToggleGroup,
): Record<PoiCategory, boolean> {
  const turnOn = !isPoiGroupOn(hidden, group);
  const next = { ...hidden };
  for (const category of group.categories) {
    next[category] = !turnOn;
  }
  return next;
}

/** Tube line network follows the Transit group (tube OR rail visible). */
export function isTransitNetworkVisible(hidden: Record<PoiCategory, boolean>): boolean {
  return !hidden.tube || !hidden.rail;
}
