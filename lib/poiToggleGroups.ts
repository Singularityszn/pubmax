import type { PoiCategory } from "@/lib/pois";
import { POI_CATEGORY_META } from "@/lib/pois";

// UI toggle groups for the map Layers control. Tube and Rail stay separate
// (plan: Tube, Rail, Bus, River, Parks, Gardens, …); map symbols stay distinct.

export type PoiToggleGroupId =
  | "tube"
  | "rail"
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
    id: "tube",
    label: "Tube",
    color: POI_CATEGORY_META.tube.color,
    categories: ["tube"],
  },
  {
    id: "rail",
    label: "Rail",
    color: POI_CATEGORY_META.rail.color,
    categories: ["rail"],
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

// Desktop default: Tube + Rail + Parks + Sights on; denser ambient categories
// off until the viewer opts in (reduces first-paint dot soup).
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

// Mobile default: keep the transport skeleton visible for orientation while
// leaving denser ambient layers opt-in. Zoom gates prevent station clutter.
export function defaultPoiHiddenMobile(): Record<PoiCategory, boolean> {
  return {
    tube: false,
    rail: false,
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

/** Coloured tube-line network follows the Tube chip only (Rail is stations). */
export function isTransitNetworkVisible(hidden: Record<PoiCategory, boolean>): boolean {
  return !hidden.tube;
}

/** One resolver for initial scene assembly and subsequent layer updates. */
export function resolveTransitNetworkVisibility(
  hidden: Record<PoiCategory, boolean>,
  override?: boolean,
): "visible" | "none" {
  return (override ?? isTransitNetworkVisible(hidden)) ? "visible" : "none";
}
