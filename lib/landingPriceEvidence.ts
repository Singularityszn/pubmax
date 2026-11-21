import {
  legacyPintPriceObservedAt,
  namedLegacyPintPriceSource,
  type LegacyPriceEvidenceRow,
} from "@/lib/legacyPriceEvidence.mjs";

export type LandingPriceEvidence = {
  source: string | null;
  observedOn: string | null;
};

export function landingPriceEvidence(
  price: number,
  rows: readonly LegacyPriceEvidenceRow[] | undefined,
  fallback?: { priceSource?: string; priceObservedAt?: string },
): LandingPriceEvidence {
  const row = rows?.find((item) =>
    typeof item.price_gbp === "number" && Math.abs(item.price_gbp - price) < 0.005 && namedLegacyPintPriceSource(item),
  );
  const useFallback = !rows?.some((item) => item.price_gbp != null);
  const fallbackDate = fallback?.priceObservedAt;
  return {
    source: row ? namedLegacyPintPriceSource(row)?.label ?? null : useFallback ? fallback?.priceSource ?? null : null,
    observedOn: row ? legacyPintPriceObservedAt(row)?.slice(0, 10) ?? null : useFallback && fallbackDate && Number.isFinite(Date.parse(fallbackDate)) ? fallbackDate.slice(0, 10) : null,
  };
}

export function landingPriceEvidenceLine(evidence?: LandingPriceEvidence): string {
  return `${evidence?.source ?? "Source unknown"} · ${evidence?.observedOn ? `source read ${evidence.observedOn}` : "read date unknown"}`;
}
