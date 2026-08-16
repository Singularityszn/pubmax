// Price evidence missions: one useful Community Price task at a time.
//
// Ranking and trust come from existing Community Price rows and policy
// (lib/communityPrice.ts). This module adds no second trust definition.
// The DTO a client may see is Venue ID, reason, optional drink category,
// and optional observation date. No price, handle, or coordinates.

import {
  isCorroborated,
  isWithinMaxAge,
  SUBMITTABLE_DRINK_CATEGORIES,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { isMapLensDrinkCategory, isDrinkCategory, type DrinkCategory } from "@/lib/drinks";

export const PRICE_EVIDENCE_MISSION_REASONS = [
  "provisional",
  "stale",
  "missing",
] as const;
export type PriceEvidenceMissionReason = (typeof PRICE_EVIDENCE_MISSION_REASONS)[number];

export const MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS = 8;
const MAX_VENUE_ID = 64;

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
};

export type MissionReceiptOutcome = "logged" | "trusted" | "needs_check";

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

function cleanVenueId(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, MAX_VENUE_ID);
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

  const pick = (list: CommunityPrice[], reason: PriceEvidenceMissionReason): PriceEvidenceMission => {
    const chosen = [...list].sort((left, right) =>
      categoryOrder(left.drinkCategory) - categoryOrder(right.drinkCategory),
    )[0];
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

export function rankPriceEvidenceMission(
  venues: readonly VenueMissionRows[],
  now: number = Date.now(),
  dismissed: ReadonlySet<string> = new Set(),
): PriceEvidenceMission | null {
  const ranked: PriceEvidenceMission[] = [];
  for (const venue of venues) {
    const candidate = candidateForVenue(venue, now);
    if (!candidate) continue;
    if (dismissed.has(priceEvidenceMissionKey(candidate))) continue;
    ranked.push(candidate);
  }
  ranked.sort((left, right) => REASON_RANK[left.reason] - REASON_RANK[right.reason]);
  return ranked[0] ?? null;
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

export function missionReceiptFromReadback(input: {
  price: CommunityPrice | null;
  now?: number;
  missionReason?: PriceEvidenceMissionReason;
}): MissionReceipt {
  void input.missionReason;
  const now = input.now ?? Date.now();
  const price = input.price;
  if (!price) {
    return { outcome: "logged", line: "Logged." };
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

export function missionHeading(input: {
  reason: PriceEvidenceMissionReason;
  venueName: string;
  drinkCategory?: DrinkCategory;
}): string {
  const name = input.venueName.trim() || "this pub";
  if (input.reason === "missing") return `Log a price at ${name}`;
  const drink = input.drinkCategory
    ? input.drinkCategory === "alcohol-free"
      ? "alcohol-free"
      : input.drinkCategory.replace("-", " ")
    : "drink";
  if (input.reason === "stale") return `The ${drink} price at ${name} is out of date`;
  return `Check the ${drink} price at ${name}`;
}
