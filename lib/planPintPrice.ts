import { pintObservationTime } from "@/lib/comparablePint.mjs";
import { firstHttp } from "@/lib/httpUrl";

export type PlanPintPriceEvidence = {
  venueId: string;
  pence: number;
  serving: "pint" | null;
  source: {
    label: string | null;
    url: string | null;
    observedAt: string | null;
  };
};

export type PlanPintPriceFields = {
  estimatedPintPricePence?: number | null;
  priceKind?: "listed" | "estimated";
  pintPriceEvidence?: PlanPintPriceEvidence;
};

export type RawPlanPintPriceFields = {
  estimatedPintPricePence?: unknown;
  priceKind?: unknown;
  priceEvidence?: unknown;
  priceServing?: unknown;
  pintPriceEvidence?: unknown;
  priceObservedAt?: unknown;
};

export type PlanPintPriceOrigin = "generated" | "stored";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function observation(value: unknown, now: number): string | null {
  if (typeof value !== "string" || value.length > 24) return null;
  const time = pintObservationTime(value, now);
  if (time === null) return null;
  return value.length === 10 || new Date(time).toISOString() === value ? value : null;
}

function cleanSource(value: unknown, now: number): PlanPintPriceEvidence["source"] {
  const source = record(value);
  const label = typeof source?.label === "string" && source.label.length <= 200
    ? source.label.trim() || null
    : null;
  const href = typeof source?.url === "string" && source.url.length <= 2_048 ? firstHttp(source.url) : "";
  const url = label && /^https?:\/\//i.test(href) ? href : null;
  return { label, url, observedAt: observation(source?.observedAt, now) };
}

/** Bind generator evidence on receipt and validate quotes saved on a route. */
export function cleanPlanPintPrice(
  venueId: string,
  row: RawPlanPintPriceFields,
  origin: PlanPintPriceOrigin,
  now = Date.now(),
): PlanPintPriceFields {
  const pence = row.estimatedPintPricePence;
  if (typeof pence !== "number" || !Number.isSafeInteger(pence) || pence <= 0 || pence > 100_000) return {};
  const estimate = { estimatedPintPricePence: pence, priceKind: "estimated" as const };
  if (row.priceKind === "estimated") return estimate;

  const listed = { estimatedPintPricePence: pence, priceKind: "listed" as const };
  if (origin === "generated") {
    const quote = record(row.priceEvidence);
    if (quote?.pence !== pence) return estimate;
    const source = cleanSource(quote.source, now);
    if (!source.label && !source.observedAt) return estimate;
    // The canonical generator price comes from the comparable pint reader.
    const comparable = source.label && source.url && source.observedAt
      && (quote.confidenceState === "fresh" || quote.confidenceState === "aging" || quote.confidenceState === "stale");
    const serving = row.priceServing === "pint" || (row.priceServing === undefined && comparable) ? "pint" : null;
    return { ...listed, pintPriceEvidence: { venueId, pence, serving, source } };
  }

  if (row.priceKind !== "listed") return estimate;
  if (row.pintPriceEvidence !== undefined) {
    const quote = record(row.pintPriceEvidence);
    if (quote?.venueId !== venueId || quote.pence !== pence) return estimate;
    const source = cleanSource(quote.source, now);
    const serving = quote.serving === "pint" ? "pint" : null;
    return { ...listed, pintPriceEvidence: { venueId, pence, serving, source } };
  }

  // The old writer saved the listed amount and read day on the same venue row.
  // Its format did not carry wire evidence, a publisher, or a serving.
  if (row.priceEvidence !== undefined || row.priceServing !== undefined) return listed;
  const observedAt = observation(row.priceObservedAt, now);
  if (observedAt === null) return listed;
  return {
    ...listed,
    pintPriceEvidence: { venueId, pence, serving: null, source: { label: null, url: null, observedAt } },
  };
}

export function matchingPlanPintPriceEvidence(
  venueId: string,
  pence: number | null | undefined,
  kind: PlanPintPriceFields["priceKind"],
  evidence: PlanPintPriceEvidence | undefined,
): PlanPintPriceEvidence | null {
  return kind === "listed" && evidence?.venueId === venueId && evidence.pence === pence ? evidence : null;
}
