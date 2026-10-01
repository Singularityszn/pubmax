import type { NightContext } from "@/lib/nightPlanning";
import type { MapLensPrice } from "@/lib/mapExperienceLens";

import { categoryLabel, isDrinkCategory, type DrinkCategory } from "@/lib/drinks";

type CommunitySelectedDrinkPriceEvidence = {
  category: DrinkCategory;
  pence: number;
  serving: null;
  source: "community";
  reportedAt: string;
};

type ListedSelectedDrinkPriceEvidence = {
  category: DrinkCategory;
  pence: number;
  serving: string | null;
  source: "listed";
  sourceUrl: string;
  observedAt: string;
};

export type SelectedDrinkPriceEvidence = CommunitySelectedDrinkPriceEvidence | ListedSelectedDrinkPriceEvidence;

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function cleanSelectedDrinkPriceEvidence(value: unknown): SelectedDrinkPriceEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isDrinkCategory(row.category) || row.category === "beer"
    || !Number.isSafeInteger(row.pence) || (row.pence as number) <= 0
    || (row.pence as number) > 100_000) return null;
  if (row.source === "community") {
    if (row.serving !== null || !canonicalTimestamp(row.reportedAt)) return null;
    return {
      category: row.category,
      pence: row.pence as number,
      serving: null,
      source: "community",
      reportedAt: row.reportedAt,
    };
  }
  if (row.source !== "listed" || !canonicalTimestamp(row.observedAt)
    || (row.serving !== null && (typeof row.serving !== "string"
      || !row.serving.trim() || row.serving !== row.serving.trim() || row.serving.length > 48
      || /[\u0000-\u001f\u007f]/.test(row.serving)))
    || typeof row.sourceUrl !== "string" || row.sourceUrl.length > 2048
    || row.sourceUrl !== row.sourceUrl.trim() || /\s|[\u0000-\u001f\u007f]/.test(row.sourceUrl)) return null;
  try {
    const url = new URL(row.sourceUrl);
    if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password) return null;
  } catch {
    return null;
  }
  return {
    category: row.category,
    pence: row.pence as number,
    serving: row.serving,
    source: "listed",
    sourceUrl: row.sourceUrl,
    observedAt: row.observedAt,
  };
}

export function selectedDrinkPriceEvidenceForPrice(
  price: MapLensPrice | null | undefined,
  context: Pick<NightContext, "drinkCategory" | "zeroProof">,
): SelectedDrinkPriceEvidence | null {
  if (context.zeroProof || !context.drinkCategory || context.drinkCategory === "beer"
    || price?.category !== context.drinkCategory
    || !Number.isFinite(price.priceGbp) || price.priceGbp <= 0) return null;
  if (price.source === "community") {
    if (typeof price.submittedAt !== "number" || !Number.isFinite(price.submittedAt)) return null;
    const reportedAt = new Date(price.submittedAt);
    if (!Number.isFinite(reportedAt.getTime())) return null;
    return cleanSelectedDrinkPriceEvidence({
      category: context.drinkCategory, pence: Math.round(price.priceGbp * 100),
      serving: null, source: "community", reportedAt: reportedAt.toISOString(),
    });
  }
  if (price.source !== "listed") return null;
  return cleanSelectedDrinkPriceEvidence({
    category: context.drinkCategory,
    pence: Math.round(price.priceGbp * 100),
    serving: price.servingSize ?? null,
    source: "listed",
    sourceUrl: price.sourceUrl,
    observedAt: price.observedAt,
  });
}

export function selectedDrinkPriceDescription(evidence: SelectedDrinkPriceEvidence | undefined): string | null {
  if (!evidence) return null;
  const reported = new Date(evidence.source === "community" ? evidence.reportedAt : evidence.observedAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  const serving = evidence.serving ? `Serving ${evidence.serving}.` : "Serving size not recorded.";
  return `${categoryLabel(evidence.category)} £${(evidence.pence / 100).toFixed(2)}, ${evidence.source === "community" ? "community report" : "published menu"} ${reported}. ${serving}`;
}
