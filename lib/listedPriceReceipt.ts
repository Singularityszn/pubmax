import { formatObservedDate } from "@/lib/dataFreshness";

/** A listed figure keeps its own publisher and read date, including unknowns. */
export function listedPriceReceipt(evidence: {
  priceSource?: string;
  priceObservedAt?: string;
}, now = Date.now()): string {
  const source = evidence.priceSource?.trim() || "Publisher not recorded";
  const read = evidence.priceObservedAt ? Date.parse(evidence.priceObservedAt) : Number.NaN;
  const date = Number.isFinite(read) && read <= now ? formatObservedDate(new Date(read)) : null;
  return `${source}. ${date ? `Source read ${date}` : "Source read date unknown"}.`;
}
