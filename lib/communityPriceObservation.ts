// Validation and conversion for committed community-price observation packs
// (Reddit harvest lane). Browser-safe.

import {
  COMMUNITY_PRICE_EVIDENCE_SOURCES,
  COMMUNITY_PRICE_MAX_GBP,
  COMMUNITY_PRICE_MIN_GBP,
  roundToPennies,
  type CommunityPrice,
  type CommunityPriceEvidenceSource,
} from "@/lib/communityPrice";
import { isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import { isRedditCommentUrl } from "@/lib/redditEvidence";

export type CommunityPriceObservationRow = {
  venueId: string;
  drinkCategory: DrinkCategory;
  drinkName: string;
  priceGbp: number;
  observedAt: string;
  source: CommunityPriceEvidenceSource;
  sourceUrl: string;
  confidence: number;
  pubNameHint?: string;
};

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
): value is CommunityPriceObservationRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (typeof row.venueId !== "string" || !row.venueId.trim()) return false;
  if (!isDrinkCategory(row.drinkCategory)) return false;
  if (typeof row.drinkName !== "string" || !row.drinkName.trim()) return false;
  if (typeof row.priceGbp !== "number" || !Number.isFinite(row.priceGbp)) return false;
  if (row.priceGbp < COMMUNITY_PRICE_MIN_GBP || row.priceGbp > COMMUNITY_PRICE_MAX_GBP) return false;
  if (row.source !== "reddit") return false;
  if (!COMMUNITY_PRICE_EVIDENCE_SOURCES.includes(row.source as CommunityPriceEvidenceSource)) {
    return false;
  }
  if (!isRedditCommentUrl(row.sourceUrl)) return false;
  if (typeof row.confidence !== "number" || !Number.isFinite(row.confidence)) return false;
  if (row.confidence < 0 || row.confidence > 1) return false;
  if (!isValidObservedAt(row.observedAt, now)) return false;
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

export function observationToCommunityPrice(row: CommunityPriceObservationRow): CommunityPrice {
  const submittedAt = Date.parse(row.observedAt);
  return {
    id: `reddit-${hashStable(`${row.venueId}|${row.drinkCategory}|${row.drinkName}|${row.priceGbp}|${row.observedAt}|${row.sourceUrl}`)}`,
    venueId: row.venueId.trim(),
    drinkCategory: row.drinkCategory,
    priceGbp: roundToPennies(row.priceGbp),
    submittedAt,
    source: "community",
    corroborations: 1,
    evidence: {
      source: row.source,
      url: row.sourceUrl,
      confidence: row.confidence,
    },
  };
}
