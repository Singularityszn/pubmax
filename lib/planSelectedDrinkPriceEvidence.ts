import type { PlanStopDTO } from "@/lib/plan";
import type { NightContext } from "@/lib/nightPlanning";
import type { MapLensPrice } from "@/lib/mapExperienceLens";

import { categoryLabel, isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import { normalizeUkPriceBundleDrinkLabel } from "@/lib/bundleDrinkFields";
import { drinkSubtypeFromText, parseDrinkSubtypeParam } from "@/lib/drinkSubtypes";

type CommunitySelectedDrinkPriceEvidence = {
  category: DrinkCategory;
  pence: number;
  serving: null;
  source: "community";
  reportedAt: string;
};

type LegacyListedSelectedDrinkPriceEvidence = {
  category: DrinkCategory;
  pence: number;
  serving: string | null;
  source: "listed";
  sourceUrl: string;
  observedAt: string;
};

type NamedListedSelectedDrinkPriceEvidence = LegacyListedSelectedDrinkPriceEvidence & {
  drinkLabel: string;
  drinkSubtype: string | null;
};

type ListedSelectedDrinkPriceEvidence = LegacyListedSelectedDrinkPriceEvidence | NamedListedSelectedDrinkPriceEvidence;

export type SelectedDrinkPriceEvidence = CommunitySelectedDrinkPriceEvidence | ListedSelectedDrinkPriceEvidence;

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function cleanNamedIdentity(row: Record<string, unknown>): Pick<NamedListedSelectedDrinkPriceEvidence, "drinkLabel" | "drinkSubtype"> | null {
  if (!Object.hasOwn(row, "drinkLabel") || !Object.hasOwn(row, "drinkSubtype")
    || typeof row.drinkLabel !== "string"
    || row.drinkLabel !== normalizeUkPriceBundleDrinkLabel(row.drinkLabel)
    || /\p{Cc}/u.test(row.drinkLabel)) return null;
  const category = row.category as DrinkCategory;
  const subtype = drinkSubtypeFromText(row.drinkLabel, category)?.id ?? null;
  if (row.drinkSubtype !== null && typeof row.drinkSubtype !== "string") return null;
  if (row.drinkSubtype !== subtype || (row.drinkSubtype !== null
    && parseDrinkSubtypeParam(row.drinkSubtype, category)?.id !== row.drinkSubtype)) return null;
  return { drinkLabel: row.drinkLabel, drinkSubtype: subtype };
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
  return cleanListedDrinkPriceEvidence(row);
}

/** Published quote validation shared with discovery; Plan applies its own category policy. */
export function cleanListedDrinkPriceEvidence(value: unknown): ListedSelectedDrinkPriceEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isDrinkCategory(row.category)
    || !Number.isSafeInteger(row.pence) || (row.pence as number) <= 0
    || (row.pence as number) > 100_000
    || row.source !== "listed" || !canonicalTimestamp(row.observedAt)
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
  const evidence: LegacyListedSelectedDrinkPriceEvidence = {
    category: row.category,
    pence: row.pence as number,
    serving: row.serving,
    source: "listed",
    sourceUrl: row.sourceUrl,
    observedAt: row.observedAt,
  };
  if (!("drinkLabel" in row) && !("drinkSubtype" in row)) return evidence;
  const identity = cleanNamedIdentity(row);
  return identity ? { ...evidence, ...identity } : null;
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
  const drinkLabel = normalizeUkPriceBundleDrinkLabel(price.drinkLabel);
  return cleanSelectedDrinkPriceEvidence({
    category: context.drinkCategory,
    pence: Math.round(price.priceGbp * 100),
    serving: price.servingSize ?? null,
    source: "listed",
    sourceUrl: price.sourceUrl,
    observedAt: price.observedAt,
    ...(drinkLabel ? { drinkLabel, drinkSubtype: drinkSubtypeFromText(drinkLabel, context.drinkCategory)?.id ?? null } : {}),
  });
}

export function selectedDrinkPriceDescription(evidence: SelectedDrinkPriceEvidence | undefined): string | null {
  if (!evidence) return null;
  const reported = new Date(evidence.source === "community" ? evidence.reportedAt : evidence.observedAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  const serving = evidence.serving ? `Serving ${evidence.serving}.` : "Serving size not recorded.";
  const drink = "drinkLabel" in evidence ? evidence.drinkLabel : categoryLabel(evidence.category);
  return `${drink} £${(evidence.pence / 100).toFixed(2)}, ${evidence.source === "community" ? "community report" : "published menu"} ${reported}. ${serving}`;
}

/** Context changes apply to the selected venue and its saved backups alike. */
export function planStopEvidenceForContext(stop: PlanStopDTO, context: NightContext | null | undefined): PlanStopDTO {
  const filter = (value: { venueId: string; venueName: string; selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence }) => {
    const evidence = cleanSelectedDrinkPriceEvidence(value.selectedDrinkPriceEvidence);
    return { venueId: value.venueId, venueName: value.venueName,
      ...(evidence && (!context ? evidence.source === "listed"
        : !context.zeroProof && evidence.category === context.drinkCategory)
        ? { selectedDrinkPriceEvidence: evidence } : {}) };
  };
  return { ...filter(stop), position: stop.position,
    ...(stop.alternatives?.length ? { alternatives: stop.alternatives.map(filter) } : {}) };
}
