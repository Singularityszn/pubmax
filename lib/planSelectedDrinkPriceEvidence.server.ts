import "server-only";

import { readCommunityPriceCategoryIndex } from "@/lib/communityPriceStore";
import { listedCategoryPrices } from "@/lib/listedCategoryPrices";
import { trustedDrinkLensPrices, type MapLensPrice } from "@/lib/mapExperienceLens";
import { cleanNightContext } from "@/lib/nightPlanning";
import type { PlanStopDTO } from "@/lib/plan";
import type { PlanStopTarget } from "@/lib/planRoute";
import { cleanSelectedDrinkPriceEvidence, type SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";

type PricedPlanStopTarget = PlanStopTarget & { selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence };

/** Resolve a submitted display hint against current, trusted server price rows. */
async function resolvePriceEvidence(
  stops: readonly PlanStopTarget[],
  submitted: readonly unknown[],
  rawContext: unknown,
): Promise<PricedPlanStopTarget[]> {
  const targets = stops.map(({ venueId, venueName }) => ({ venueId, venueName }));
  const context = cleanNightContext(rawContext);
  const category = context?.zeroProof ? null : context?.drinkCategory;
  if (!category || category === "beer") return targets;
  const requested = submitted.map((raw) => cleanSelectedDrinkPriceEvidence(
    raw && typeof raw === "object" ? (raw as Record<string, unknown>).selectedDrinkPriceEvidence : null,
  ));
  if (!requested.some((evidence) => evidence?.category === category)) return targets;

  const now = Date.now();
  const trusted = new Map<string, MapLensPrice>();
  try {
    const index = await readCommunityPriceCategoryIndex([category], now);
    if (!index.degraded && !index.truncated) {
      const rowsByVenue = new Map<string, typeof index.prices>();
      for (const row of index.prices) {
        const rows = rowsByVenue.get(row.venueId) ?? [];
        rowsByVenue.set(row.venueId, [...rows, row]);
      }
      for (const [venueId, price] of trustedDrinkLensPrices(rowsByVenue, category, now)) {
        trusted.set(venueId, price);
      }
    }
  } catch {
    // Community availability does not decide whether a cited listing exists.
  }

  const listedByVenue = new Map<string, SelectedDrinkPriceEvidence[]>();
  const listedVenueIds = [...new Set(targets.flatMap((stop, position) =>
    requested[position]?.source === "listed" && requested[position]?.category === category
      && !trusted.has(stop.venueId) ? [stop.venueId] : [],
  ))];
  await Promise.all(listedVenueIds.map(async (venueId) => {
    try {
      const bundle = await ukPriceBundleRowsFor(venueId);
      if (bundle.status !== "ready") return;
      const evidence = listedCategoryPrices(bundle.rows, now)
        .filter((quote) => quote.category === category)
        .map((quote) => cleanSelectedDrinkPriceEvidence({
          category: quote.category, pence: Math.round(quote.priceGbp * 100),
          serving: quote.servingSize, source: "listed", sourceUrl: quote.sourceUrl,
          observedAt: new Date(quote.observedAt).toISOString(),
        }))
        .filter((quote): quote is SelectedDrinkPriceEvidence => quote?.source === "listed");
      listedByVenue.set(venueId, evidence);
    } catch {
      // An unavailable bundle cannot validate a client hint.
    }
  }));

  return targets.map((stop, position) => {
    const hint = requested[position];
    if (!hint || hint.category !== category) return stop;
    const price = trusted.get(stop.venueId);
    if (hint.source === "community") {
      if (!price || price.source !== "community" || typeof price.submittedAt !== "number") return stop;
      const serverEvidence = cleanSelectedDrinkPriceEvidence({
        category, pence: Math.round(price.priceGbp * 100), serving: null,
        source: "community", reportedAt: new Date(price.submittedAt).toISOString(),
      });
      return serverEvidence?.source === "community"
        && serverEvidence.pence === hint.pence && serverEvidence.reportedAt === hint.reportedAt
        ? { ...stop, selectedDrinkPriceEvidence: serverEvidence }
        : stop;
    }
    if (price) return stop;
    const listed = listedByVenue.get(stop.venueId)?.find((candidate) =>
      candidate.source === "listed" && candidate.pence === hint.pence
      && candidate.serving === hint.serving && candidate.sourceUrl === hint.sourceUrl
      && candidate.observedAt === hint.observedAt,
    );
    return listed ? { ...stop, selectedDrinkPriceEvidence: listed } : stop;
  });
}

export async function resolvePlanSelectedDrinkPriceEvidence(
  stops: readonly (PlanStopTarget & { alternatives?: PlanStopDTO["alternatives"] })[],
  submitted: readonly unknown[],
  rawContext: unknown,
): Promise<(PricedPlanStopTarget & { alternatives?: PlanStopDTO["alternatives"] })[]> {
  const targets = stops.flatMap((stop) => [stop, ...(stop.alternatives ?? [])]);
  const hints = stops.flatMap((stop, position) => {
    const raw = submitted[position];
    const backups = raw && typeof raw === "object" ? (raw as Record<string, unknown>).alternatives : null;
    return [raw, ...(stop.alternatives ?? []).map((_, index) => Array.isArray(backups) ? backups[index] : undefined)];
  });
  const verified = await resolvePriceEvidence(targets, hints, rawContext);
  let offset = 0;
  return stops.map((stop) => {
    const primary = verified[offset++];
    const alternatives = verified.slice(offset, offset + (stop.alternatives?.length ?? 0));
    offset += alternatives.length;
    return { ...primary, ...(alternatives.length ? { alternatives } : {}) };
  });
}
