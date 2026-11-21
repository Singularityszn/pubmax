import type { EstimatedPriceInput } from "@/lib/priceTier";

export function isSampledPintEstimate(value: unknown): value is EstimatedPriceInput {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.priceGbp === "number" && Number.isFinite(row.priceGbp) && row.priceGbp >= 2 && row.priceGbp <= 12 &&
    Number.isInteger(row.sampleSize) && (row.sampleSize as number) >= 3 &&
    typeof row.computedAt === "string" && Number.isFinite(Date.parse(row.computedAt)) &&
    typeof row.basis === "string" && /^(nearby:2|locality:.+|postcode_area:[A-Z]{1,2}|nearest_region:[A-Z]{1,2}|uk_median:UK|regional_baseline:.+|chain_menu:.+)$/.test(row.basis);
}

export function sampledPintEstimateNote(estimate: EstimatedPriceInput): string | null {
  if (!isSampledPintEstimate(estimate)) return null;
  if (estimate.basis === "nearby:2") return `Estimate from ${estimate.sampleSize} pubs within 2 km.`;
  const [kind, ...parts] = estimate.basis.split(":");
  const area = parts.join(":");
  if (kind === "nearest_region") return `Estimate from ${estimate.sampleSize} pubs in the nearest sampled postcode area, ${area}.`;
  if (kind === "uk_median") return `UK average from ${estimate.sampleSize} pubs.`;
  if (kind === "regional_baseline") return `Estimate from a regional baseline for ${area}, using ${estimate.sampleSize} values.`;
  if (kind === "chain_menu") return `Estimate from ${estimate.sampleSize} published chain menu prices.`;
  return kind === "locality"
    ? `Estimate from ${estimate.sampleSize} pubs in ${area}.`
    : `Estimate from ${estimate.sampleSize} pubs in postcode area ${area}.`;
}
