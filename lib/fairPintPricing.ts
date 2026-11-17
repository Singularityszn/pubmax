import { buildPriceEvidence, priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
import type { FairPintPin } from "@/lib/fairPint";

export function fairPence(pin: FairPintPin, now: number): number | null {
  if (!pin.fairPint) return null;
  const [pence, url, observedAt] = pin.fairPint;
  const evidence = buildPriceEvidence({ pence, url, observedAt, label: "Pint Prices", now });
  return priceEvidenceUsableForCeiling(evidence) ? evidence.pence : null;
}

export function isFairPint(pin: FairPintPin, ceiling: number, now: number): boolean {
  const pence = fairPence(pin, now);
  return pence !== null && pence <= ceiling;
}
