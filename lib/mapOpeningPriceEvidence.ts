import { legacyCheapestPriceEvidence, legacyCheapestPriceReadDay, type LegacyPriceEvidenceRow } from "@/lib/legacyPriceEvidence.mjs";
import { priceAgeFor, priceAgeNote } from "@/lib/priceTier";

export function openingPriceEvidence(price: number, rows: readonly LegacyPriceEvidenceRow[], slimDigest: string, detailDigest: string, now = Date.now()): null | { drink: string; source: string; date: string; aging: boolean; ageNote: string } {
  if (!slimDigest || slimDigest !== detailDigest) return null;
  const evidence = legacyCheapestPriceEvidence(rows, price, now);
  const date = legacyCheapestPriceReadDay(rows, price);
  if (!evidence.cheapestPint?.trim() || !evidence.priceSource?.trim() || !evidence.priceObservedAt || !date) return null;
  const aging = priceAgeFor("published", date, now) === "aging";
  return {
    drink: evidence.cheapestPint.trim(),
    source: evidence.priceSource.trim(),
    date,
    aging,
    ageNote: aging ? priceAgeNote("published", date, now) : "",
  };
}
