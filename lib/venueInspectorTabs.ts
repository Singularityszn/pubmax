import { getCity, type CityId } from "@/lib/cities";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";

// Mobile-first tabs regroup the panel's long vertical scroll into thumb-friendly
// sections (most PUBMAXXERs are on a phone while travelling). The labels follow
// the mobile product contract while retaining stable internal keys/URLs.
//
// FIVE TABS, ONE ROW. Seven tabs wrapped into two rows on a 390px phone (site
// audit 13 Sep 2026, D10), and a sideways-scrolling strip before that hid the
// last ones past the edge. Ask lives inside Lore, because it asks about the
// pub's own history, and the getting-home card lives inside Overview, beside
// getting there. Every section is still one tap from the sheet.
export type TabKey = "overview" | "photos" | "pints" | "menu" | "story";

/** A section a caller may ask the sheet to open on: a tab, or a section inside one. */
export type VenueTabRequest = TabKey | "ask" | "getting-home";

export const BASE_TABS: { key: TabKey; label: string; shortLabel: string }[] = [
  { key: "overview", label: "Overview", shortLabel: "Overview" },
  // The wall sits second because it is the most-looked-at thing about a pub
  // after what it costs, and because a photo is the one section a reader can
  // judge in a glance rather than by reading.
  { key: "photos", label: "Photos", shortLabel: "Photos" },
  { key: "menu", label: "Drinks", shortLabel: "Drinks" },
  { key: "pints", label: "Stories", shortLabel: "Stories" },
  { key: "story", label: "Lore", shortLabel: "Lore" },
];

export const DEFAULT_TAB: TabKey = "overview";

const TAB_KEYS = new Set<string>(BASE_TABS.map((tab) => tab.key));

/** The tab that carries a requested section. Unknown or empty lands on Overview. */
export function resolveVenueTab(request: string): TabKey {
  if (request === "ask") return "story";
  if (request === "getting-home") return "overview";
  return TAB_KEYS.has(request) ? (request as TabKey) : DEFAULT_TAB;
}

/**
 * The getting-home section's name. London's card is branded "Last Pint", but a
 * section named only "Pint" collides with Pint Drops, so it names the transport
 * mode; the card keeps the branded copy inside.
 */
export function gettingHomeLabel(cityId: CityId): string {
  const city = getCity(cityId);
  return city.lastRideLabel === "Last Pint" ? "Last train" : city.lastRideLabel;
}

export function tabsForVenue(
  kind: VenueKind | undefined,
): { key: TabKey; label: string; shortLabel: string }[] {
  return isPubVenueKind(kind) ? BASE_TABS : BASE_TABS.filter((tab) => tab.key !== "pints");
}
