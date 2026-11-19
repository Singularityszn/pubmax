// THE VENUE SHEET'S ACTION CARD (launch plan 1 Nov 2026, section 5: Airbnb's
// reservation card). One compact card that stays in view while the Overview
// scrolls: the pub's best honest price with its trust words and its date, the
// walk if known, the ONE coral door and "Ask for a table", with Share beside it.
// On a phone it is the sheet's footer, above the safe area; from 641px it is
// the sticky top of the drawer, under its head.
//
// This leaf holds the card's two decisions that are not a component's:
//
//   1. THE DATE BESIDE THE PRICE is the date the Overview's own price block
//      prints for the same lane, through the same formatters, so the card and
//      the block cannot date one figure two ways. It reads the lane the sheet
//      already decided (lib/venuePriceLane.ts) and decides no price itself.
//      A baseline's caption already names its collection day, and a modelled
//      figure was observed by nobody, so both answer null here.
//   2. THE CARD SPENDS THE SHEET'S ONE CORAL. Its first row's door (the plan
//      door, or "Log what you paid", lib/venuePlanDoor.ts) is the one painted
//      control on the venue sheet at every width; the Overview's price door is
//      drawn in ink beside it (app/globals.css `.priceDoor`), so exactly one
//      coral button is ever in view (docs/DESIGN_SYSTEM.md, "Coral is spent
//      twice").

import { haversineKm } from "@/lib/haversine";
import { mapReaderPositionMeasures } from "@/lib/mapReaderPosition";
import { anchorMonthLabel } from "@/lib/venueAnchorPresentation";
import type { VenuePriceLane } from "@/lib/venuePriceLane";
import { formatFreshness, formatObservedAt, type Venue } from "@/lib/venues";

/** The one painted control the card carries, by class. Pinned by the card's tests. */
export const ACTION_CARD_CORAL_CLASS = "mobileVenuePeekPlanDoor";

/**
 * The date the Overview prints beside this lane's figure, or null when the
 * lane carries none of its own.
 */
export function venueActionCardPriceDate(
  lane: VenuePriceLane | null,
  venue: Pick<Venue, "latestContributorAt" | "anchorObservedAt">,
  now: Date = new Date(),
): string | null {
  if (!lane) return null;
  switch (lane.lane) {
    case "contributor":
      return formatFreshness(venue.latestContributorAt, now) || null;
    case "sourced":
      return formatObservedAt(lane.sourcedPrice.observedAt, now) || null;
    case "listed":
      return formatObservedAt(lane.listed.observedAt, now) || null;
    case "provisional":
    case "aged":
    case "disputed":
      return formatFreshness(lane.observedAt, now) || null;
    case "anchor":
      return anchorMonthLabel(venue.anchorObservedAt);
    case "baseline":
    case "estimate":
      return null;
  }
}

/** Minutes a kilometre takes on foot, at the pace the phone peek always used. */
const WALK_MINUTES_PER_KM = 12.5;

/** Past this walk a position the reader never offered is only "far". */
const SHOWN_POSITION_WALK_CEILING_MINUTES = 60;

/**
 * The walk from where the reader stands to the pub, in whole minutes and never
 * less than one, or null when the reader has not shared a location. A
 * straight-line estimate, as the peek always printed it, so the card says
 * "walk" beside it and never a route.
 */
export function venueActionCardWalkMinutes(
  from: { lat: number; lng: number } | null | undefined,
  to: { latitude: number; longitude: number },
): number | null {
  if (!from) return null;
  const km = haversineKm([from.lng, from.lat], [to.longitude, to.latitude]);
  return Number.isFinite(km) ? Math.max(1, Math.ceil(km * WALK_MINUTES_PER_KM)) : null;
}

/**
 * Whole minutes; "far" for a shown position over an hour away; "rough" for a
 * shown position too coarse to measure from; null with no position at all.
 */
export type VenueActionCardWalk = number | "far" | "rough" | null;

/**
 * The walk the card prints. `from` is the location the reader offered. `shown`
 * is the position the map already paints for a reader who granted location
 * earlier: it answers when `from` is absent. Past an hour it answers "far",
 * because a reader looking across the city did not ask for a long walk. A
 * coarse fix answers "rough", because minutes from it would claim a precision
 * nobody measured. Neither may read as location being off. Worked out on the
 * device.
 */
export function venueActionCardWalk(
  from: { lat: number; lng: number } | null | undefined,
  to: { latitude: number; longitude: number },
  shown: { lat: number; lng: number; accuracyMeters?: number } | null | undefined,
): VenueActionCardWalk {
  if (from) return venueActionCardWalkMinutes(from, to);
  if (shown && !mapReaderPositionMeasures(shown)) return "rough";
  const minutes = venueActionCardWalkMinutes(shown, to);
  return minutes !== null && minutes > SHOWN_POSITION_WALK_CEILING_MINUTES ? "far" : minutes;
}
