// Validation and conversion for committed community-price observation packs
// (Reddit harvest lane). Browser-safe.

import {
  COMMUNITY_PRICE_MAX_GBP,
  COMMUNITY_PRICE_MIN_GBP,
} from "@/lib/communityPrice";
import { isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import { cleanDrinkMeasureLabel, statedDrinkMeasure, type DrinkMeasure } from "@/lib/drinkMeasure";
import { isRedditCommentUrl } from "@/lib/redditEvidence";

export type CommunityPriceObservationRow = {
  venueId: string;
  drinkCategory: DrinkCategory;
  drinkName: string;
  priceGbp: number;
  observedAt: string;
  source: "reddit";
  sourceUrl: string;
  confidence: number;
  measure?: DrinkMeasure;
  measureLabel?: string;
  pubNameHint?: string;
};

export type CommunityPriceEvidenceObservation = Omit<CommunityPriceObservationRow, "pubNameHint"> & { id: string };

export type CommunityPriceObservationPack = {
  version: 1;
  generatedAt: string;
  lane: "reddit-london";
  observations: CommunityPriceObservationRow[];
};

function isValidObservedAt(value: unknown, now: number): value is string {
  if (typeof value !== "string" || !value) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 && ms <= now;
}

export function isValidCommunityPriceObservationRow(
  value: unknown,
  now: number = Date.now(),
  knownVenueIds?: ReadonlySet<string>,
): value is CommunityPriceObservationRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (typeof row.venueId !== "string" || !row.venueId.trim()) return false;
  if (knownVenueIds && !knownVenueIds.has(row.venueId)) return false;
  if (!isDrinkCategory(row.drinkCategory)) return false;
  if (typeof row.drinkName !== "string" || !row.drinkName.trim()) return false;
  if (typeof row.priceGbp !== "number" || !Number.isFinite(row.priceGbp)) return false;
  if (row.priceGbp < COMMUNITY_PRICE_MIN_GBP || row.priceGbp > COMMUNITY_PRICE_MAX_GBP) return false;
  if (row.source !== "reddit") return false;
  if (!isRedditCommentUrl(row.sourceUrl)) return false;
  if (typeof row.confidence !== "number" || !Number.isFinite(row.confidence)) return false;
  if (row.confidence < 0 || row.confidence > 1) return false;
  if (!isValidObservedAt(row.observedAt, now)) return false;
  const measure = statedDrinkMeasure(row.measure);
  if (row.measure !== undefined && !measure) return false;
  if (row.measureLabel !== undefined && (typeof row.measureLabel !== "string" || measure !== "other" ||
    !row.measureLabel || cleanDrinkMeasureLabel(row.measureLabel) !== row.measureLabel)) return false;
  if (row.pubNameHint !== undefined && typeof row.pubNameHint !== "string") return false;
  return true;
}

function hashStable(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Stable evidence identity includes the named drink and any stated serving. */
export function communityPriceObservationId(row: CommunityPriceObservationRow): string {
  return `reddit-${hashStable(`${row.venueId}|${row.drinkCategory}|${row.drinkName}|${row.measure ?? ""}|${row.measureLabel ?? ""}|${row.priceGbp}|${row.observedAt}|${row.sourceUrl}`)}`;
}

export function communityPriceEvidenceObservationFromRow(row: CommunityPriceObservationRow): CommunityPriceEvidenceObservation {
  return {
    id: communityPriceObservationId(row),
    venueId: row.venueId.trim(),
    drinkCategory: row.drinkCategory,
    drinkName: row.drinkName.trim(),
    priceGbp: row.priceGbp,
    observedAt: row.observedAt,
    source: "reddit",
    sourceUrl: row.sourceUrl,
    confidence: row.confidence,
    ...(row.measure ? { measure: row.measure } : {}),
    ...(row.measureLabel ? { measureLabel: row.measureLabel } : {}),
  };
}
