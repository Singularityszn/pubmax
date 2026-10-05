// Price evidence missions: one useful Community Price task at a time.
//
// Ranking and trust come from existing Community Price rows and policy
// (lib/communityPrice.ts). This module adds no second trust definition.
// The DTO a client may see is Venue ID, reason, optional drink category,
// and optional observation date. No price, handle, or coordinates.

import { cleanVenueId } from "@/lib/cleanVenueId";
import {
  isCorroborated,
  isWithinMaxAge,
  SUBMITTABLE_DRINK_CATEGORIES,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { isMapLensDrinkCategory, isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
// Type-only, so this browser-safe module pulls no drop-lane runtime behind it.
import type { PintTrustState } from "@/lib/pintTrust";
import { drinkLensPriceNoun } from "@/lib/mapExperienceLens";
import type { MissionSurface } from "@/lib/analyticsEvents";

export const PRICE_EVIDENCE_MISSION_REASONS = [
  "provisional",
  "stale",
  "missing",
] as const;
export type PriceEvidenceMissionReason = (typeof PRICE_EVIDENCE_MISSION_REASONS)[number];

export const MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS = 8;

export type PriceEvidenceMission = {
  venueId: string;
  reason: PriceEvidenceMissionReason;
  drinkCategory?: DrinkCategory;
  observedAt?: number;
};

export type VenueMissionRows = {
  venueId: string;
  prices: readonly CommunityPrice[];
  degraded?: boolean;
  /**
   * True when the public Pint Index cannot DATE this pub: no Pint Drop here
   * holds a live confirmation. It changes the ORDER and never the reason, so no
   * reading surface has to learn a new word, and the count of undated pubs is
   * not something a client is told.
   */
  undated?: boolean;
};

type MissionReceiptOutcome = "logged" | "trusted" | "needs_check";

export type MissionReceipt = {
  outcome: MissionReceiptOutcome;
  line: string;
};

const REASON_RANK: Record<PriceEvidenceMissionReason, number> = {
  provisional: 0,
  stale: 1,
  missing: 2,
};

export function isPriceEvidenceMissionReason(
  value: unknown,
): value is PriceEvidenceMissionReason {
  return (
    typeof value === "string" &&
    (PRICE_EVIDENCE_MISSION_REASONS as readonly string[]).includes(value)
  );
}

export function priceEvidenceMissionKey(mission: PriceEvidenceMission): string {
  return `${mission.venueId}\u0000${mission.reason}\u0000${mission.drinkCategory ?? ""}`;
}

export function parsePriceEvidenceMissionVenueIds(
  rawIds: readonly string[],
): { ok: true; venueIds: string[] } | { ok: false } {
  const venueIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawIds) {
    const venueId = cleanVenueId(raw);
    if (!venueId || seen.has(venueId)) continue;
    seen.add(venueId);
    venueIds.push(venueId);
  }
  if (venueIds.length === 0 || venueIds.length > MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS) {
    return { ok: false };
  }
  return { ok: true, venueIds };
}

function submittableRows(prices: readonly CommunityPrice[]): CommunityPrice[] {
  return prices.filter((price) =>
    (SUBMITTABLE_DRINK_CATEGORIES as readonly string[]).includes(price.drinkCategory),
  );
}

function categoryOrder(category: DrinkCategory): number {
  const index = SUBMITTABLE_DRINK_CATEGORIES.indexOf(category);
  return index === -1 ? SUBMITTABLE_DRINK_CATEGORIES.length : index;
}

type RankedMission = { mission: PriceEvidenceMission; undated: boolean };

function candidateForVenue(
  venue: VenueMissionRows,
  now: number,
): PriceEvidenceMission | null {
  if (venue.degraded && venue.prices.length === 0) return null;
  const rows = submittableRows(venue.prices);
  if (rows.length === 0) {
    return { venueId: venue.venueId, reason: "missing" };
  }

  const byCategory = new Map<DrinkCategory, CommunityPrice>();
  for (const price of rows) {
    const held = byCategory.get(price.drinkCategory);
    if (!held || price.submittedAt >= held.submittedAt) {
      byCategory.set(price.drinkCategory, price);
    }
  }

  const provisional: CommunityPrice[] = [];
  const stale: CommunityPrice[] = [];
  for (const price of byCategory.values()) {
    if (isWithinMaxAge(price, now) && isCorroborated(price)) continue;
    if (isWithinMaxAge(price, now)) provisional.push(price);
    else stale.push(price);
  }

  const pick = (list: CommunityPrice[], reason: PriceEvidenceMissionReason): PriceEvidenceMission | null => {
    const chosen = [...list].sort((left, right) =>
      categoryOrder(left.drinkCategory) - categoryOrder(right.drinkCategory),
    )[0];
    if (!chosen) return null;
    return {
      venueId: venue.venueId,
      reason,
      drinkCategory: chosen.drinkCategory,
      observedAt: chosen.submittedAt,
    };
  };

  if (provisional.length > 0) return pick(provisional, "provisional");
  if (stale.length > 0) return pick(stale, "stale");
  return null;
}

/**
 * The one mission to offer, most useful first.
 *
 * The REASON still decides, exactly as before: a provisional price one report
 * away from trust beats a stale one, which beats a pub with nothing logged.
 * Within a reason, a pub the public Pint Index cannot DATE comes first, because
 * that is the pub where one more price turns a figure nobody can cite into one
 * anybody can. It is a tie-break and never a promotion: an undated pub with
 * nothing logged still ranks behind a dated pub whose price is one check away.
 */
export function rankPriceEvidenceMission(
  venues: readonly VenueMissionRows[],
  now: number = Date.now(),
  dismissed: ReadonlySet<string> = new Set(),
): PriceEvidenceMission | null {
  const ranked: RankedMission[] = [];
  for (const venue of venues) {
    const candidate = candidateForVenue(venue, now);
    if (!candidate) continue;
    if (dismissed.has(priceEvidenceMissionKey(candidate))) continue;
    ranked.push({ mission: candidate, undated: venue.undated === true });
  }
  ranked.sort(
    (left, right) =>
      REASON_RANK[left.mission.reason] - REASON_RANK[right.mission.reason] ||
      Number(right.undated) - Number(left.undated),
  );
  return ranked[0]?.mission ?? null;
}

export function toPriceEvidenceMissionDto(
  mission: PriceEvidenceMission,
): PriceEvidenceMission {
  const dto: PriceEvidenceMission = {
    venueId: mission.venueId,
    reason: mission.reason,
  };
  if (mission.reason !== "missing" && mission.drinkCategory && isDrinkCategory(mission.drinkCategory)) {
    dto.drinkCategory = mission.drinkCategory;
  }
  if (
    mission.reason !== "missing" &&
    typeof mission.observedAt === "number" &&
    Number.isFinite(mission.observedAt)
  ) {
    dto.observedAt = mission.observedAt;
  }
  return dto;
}

/**
 * What the receipt may say about a BEER write, read off the pint trust story
 * rather than off community corroborations (battle test D07).
 *
 * The two lanes are different questions. `isCorroborated` counts independent
 * COMMUNITY PRICE submitters; `pintTrustFor` reads the PINT DROP lane, where
 * independence is an authority key derived from a verified account. Over one
 * pub they disagreed - a seeded community row from a second actor is not a
 * second Pint Drop - and the receipt printed "Price is trusted now." above a
 * head reading "Logged once, needs a second drinker".
 *
 * So for beer the drop lane's state decides, and nothing else does. A state we
 * could not read answers null, and the caller then declines to claim trust
 * instead of falling back to the lane that was wrong.
 */
function beerReceiptFromTrust(trust: PintTrustState): MissionReceipt {
  switch (trust) {
    case "confirmed":
    case "corroborated":
      return { outcome: "trusted", line: "Price is trusted now." };
    case "logged-once":
      return {
        outcome: "needs_check",
        line: "Another independent check is still needed.",
      };
    case "disputed":
      // A split pub is not a pub nothing speaks for, and it is not one report
      // short either: two drinkers have spoken and they differ. The receipt
      // says which thing would settle it (captain 7 Sept 2026).
      return {
        outcome: "needs_check",
        line: "Drinkers here report different prices. A second drinker reporting the same figure confirms it.",
      };
    default:
      // `aged-out` and `none` are both "nothing here speaks for tonight yet",
      // and neither may be worded as a check that is nearly done.
      return { outcome: "logged", line: "Logged." };
  }
}

export function missionReceiptFromReadback(input: {
  price: CommunityPrice | null;
  /**
   * The venue's pint trust state as the SERVER read it after this write
   * (`readVenuePintTrust`). Present on a beer write, absent on every other
   * category, and null when the read could not be taken.
   */
  pintTrust?: PintTrustState | null;
  now?: number;
}): MissionReceipt {
  const now = input.now ?? Date.now();
  const price = input.price;
  if (!price) {
    return { outcome: "logged", line: "Logged." };
  }
  // BEER IS THE PINT LANE'S QUESTION, and it is asked of the pint lane. A read
  // we could not take says "Logged." rather than borrowing the other lane's
  // stronger word, which is the whole of what D07 was.
  if (price.drinkCategory === "beer") {
    return input.pintTrust
      ? beerReceiptFromTrust(input.pintTrust)
      : { outcome: "logged", line: "Logged." };
  }
  if (isWithinMaxAge(price, now) && isCorroborated(price)) {
    if (!isMapLensDrinkCategory(price.drinkCategory)) {
      return { outcome: "logged", line: "Logged." };
    }
    return { outcome: "trusted", line: "Price is trusted now." };
  }
  if (isWithinMaxAge(price, now) && !isCorroborated(price)) {
    return {
      outcome: "needs_check",
      line: "Another independent check is still needed.",
    };
  }
  return { outcome: "logged", line: "Logged." };
}

/**
 * The one drink a mission is about, or null when the contributor may choose.
 * The heading and the composer's locked drink both read this, so a mission can
 * never name one drink and submit another.
 */
export function missionNamedCategory(mission: {
  reason: PriceEvidenceMissionReason;
  drinkCategory?: DrinkCategory;
}): DrinkCategory | null {
  if (mission.reason === "missing") return null;
  if (!mission.drinkCategory || !isDrinkCategory(mission.drinkCategory)) return null;
  return mission.drinkCategory;
}

/**
 * A price belongs to the drink that was on screen when the figure was entered.
 *
 * The composer mounts before its mission read answers, so a mission landing a
 * second later would otherwise re-label a figure already typed: £5.20 entered
 * under Beer would be submitted as a Wine price. Entering a figure therefore
 * HOLDS the visible drink, and only the drinker may change it - by clearing
 * the field, or by choosing another drink.
 */
export function holdSubmitCategory(input: {
  held: DrinkCategory | null;
  nextPrice: string;
  visible: DrinkCategory;
}): DrinkCategory | null {
  if (input.nextPrice.trim() === "") return null;
  return input.held ?? input.visible;
}

/** The drink a tap submits under: the held one first, then the mission's, then the chosen. */
export function effectiveSubmitCategory(input: {
  held: DrinkCategory | null;
  mission: DrinkCategory | null;
  chosen: DrinkCategory;
}): DrinkCategory {
  return input.held ?? input.mission ?? input.chosen;
}

/**
 * `other` is the honest catch-all, so it names no drink: a heading over it
 * drops the noun rather than printing the category word as one.
 */
function missionDrinkNoun(category: DrinkCategory | null): string {
  if (!category || category === "other") return "";
  return `${drinkLensPriceNoun(category)} `;
}

export function missionHeading(input: {
  reason: PriceEvidenceMissionReason;
  venueName: string;
  drinkCategory?: DrinkCategory;
}): string {
  const name = input.venueName.trim() || "this pub";
  if (input.reason === "missing") return `Log a price at ${name}`;
  const drink = missionDrinkNoun(missionNamedCategory(input));
  if (input.reason === "stale") return `The ${drink}price at ${name} is out of date`;
  return `Check the ${drink}price at ${name}`;
}

/**
 * The closed analytics shape every mission surface sends: surface, reason, an
 * optional category and an optional outcome. No venue, handle or free text.
 */
export function missionAnalyticsProps(
  surface: MissionSurface,
  mission: { reason: PriceEvidenceMissionReason; drinkCategory?: DrinkCategory },
  extra?: Record<string, string>,
): Record<string, string> {
  const props: Record<string, string> = {
    surface,
    reason: mission.reason,
    ...extra,
  };
  if (mission.drinkCategory) props.category = mission.drinkCategory;
  return props;
}
