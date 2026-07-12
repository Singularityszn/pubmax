import { getCity, type CityId } from "@/lib/cities";
import { lastRideTabLabel } from "@/lib/lastRide";

// Mobile-first tabs regroup the panel's long vertical scroll into thumb-friendly
// sections (most PUBMAXXERs are on a phone while travelling). Drops is the
// primary tab. "getting-home" is a placeholder slot the orchestrator fills with
// a transport card built by another agent — we only render its mount point here.
export type TabKey = "overview" | "pints" | "menu" | "story" | "ask" | "getting-home";

export const BASE_TABS: { key: TabKey; label: string; shortLabel: string }[] = [
  { key: "overview", label: "Pub", shortLabel: "Pub" },
  // "Pints" is the narrow-width form — shorter than "Drops" so the whole strip
  // (5-6 tabs) fits at 390px without clipping. Plural form avoids colliding
  // with London's getting-home tab, whose short label is "Pint" (from "Last
  // Pint" via lastRideTabLabel) — see lib/lastRide.ts.
  { key: "pints", label: "Drops", shortLabel: "Pints" },
  { key: "menu", label: "Menu", shortLabel: "Menu" },
  { key: "story", label: "Lore", shortLabel: "Lore" },
  { key: "ask", label: "Ask", shortLabel: "Ask" },
];

export function tabsForCity(cityId: CityId): { key: TabKey; label: string; shortLabel: string }[] {
  const ride = lastRideTabLabel(getCity(cityId).lastRideLabel);
  return [
    ...BASE_TABS,
    { key: "getting-home", label: ride, shortLabel: ride },
  ];
}

export const DEFAULT_TAB: TabKey = "pints";
