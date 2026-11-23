import {
  legacyPintPriceObservedAt,
  namedLegacyPintPriceSource,
  type LegacyPriceEvidenceRow,
} from "@/lib/legacyPriceEvidence.mjs";
import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { londonDayKey } from "@/lib/londonHour";

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
  const observedAt = row ? legacyPintPriceObservedAt(row) : useFallback ? fallback?.priceObservedAt : null;
  const observedTime = observedAt ? Date.parse(observedAt) : NaN;
  return {
    source: row ? namedLegacyPintPriceSource(row)?.label ?? null : useFallback ? fallback?.priceSource ?? null : null,
    observedOn: Number.isFinite(observedTime) ? londonDayKey(observedTime) : null,
  };
}

/** "9 November 2026" for a London day key, the way every read day on the home page prints. */
export function landingReadDay(observedOn: string): string {
  const ms = Date.parse(`${observedOn}T12:00:00.000Z`);
  return Number.isFinite(ms) ? formatObservedDate(new Date(ms)) : observedOn;
}

/** The rail's evidence line. The date's spaces do not break, so a narrow row never strands the year. */
export function landingPriceEvidenceLine(evidence?: LandingPriceEvidence): string {
  const day = evidence?.observedOn ? landingReadDay(evidence.observedOn).replaceAll(" ", "\u00a0") : null;
  return `${evidence?.source ?? "Source unknown"} · ${day ? `source read ${day}` : "read date unknown"}`;
}
