import "server-only";

import { readCommunityPriceCategoryIndex } from "@/lib/communityPriceStore";
import { listedCategoryPrices } from "@/lib/listedCategoryPrices";
import { trustedDrinkLensPrices, type MapLensPrice } from "@/lib/mapExperienceLens";
import { cleanNightContext } from "@/lib/nightPlanning";
import type { PlanStopTarget } from "@/lib/planRoute";
import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";
import { cleanSelectedDrinkPriceEvidence, selectedDrinkPriceEvidenceForPrice, type SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";

type PricedPlanStopTarget = PlanStopTarget & { selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence };

/** Resolve a submitted display hint against current, trusted server price rows. */
async function resolvePriceEvidence(
  stops: readonly PlanStopTarget[],
  submitted: readonly unknown[],
  rawContext: unknown,
): Promise<PricedPlanStopTarget[]> {
  const targets = stops.map(({ venueId, venueName }) => ({ venueId, venueName }));
  const context = cleanNightContext(rawContext);
  const contextAbsent = rawContext === null || rawContext === undefined;
  const category = context?.zeroProof ? null : context?.drinkCategory;
  // A manual Plan may carry a listed display hint without inventing Night Context.
  // An explicit context still owns category/zero-proof; malformed context cannot fall back.
  if (!contextAbsent && (!category || category === "beer")) return targets;
  const requested = submitted.map((raw) => cleanSelectedDrinkPriceEvidence(
    raw && typeof raw === "object" ? (raw as Record<string, unknown>).selectedDrinkPriceEvidence : null,
  ));
  if (!requested.some((evidence) => contextAbsent
    ? evidence?.source === "listed" : evidence?.category === category)) return targets;

  const now = Date.now();
  const communityRequested = requested.some((evidence) => evidence?.source === "community" && evidence.category === category);
  const listedRequested = requested.some((evidence) => evidence?.source === "listed"
    && (contextAbsent || evidence.category === category));
  const trustedCommunity = new Map<string, MapLensPrice>();
  if (communityRequested && category) {
    try {
      const index = await readCommunityPriceCategoryIndex([category], now);
      if (!index.degraded && !index.truncated) {
        const rowsByVenue = new Map<string, typeof index.prices>();
        for (const row of index.prices) {
          const rows = rowsByVenue.get(row.venueId) ?? [];
          rowsByVenue.set(row.venueId, [...rows, row]);
        }
        for (const [venueId, price] of trustedDrinkLensPrices(rowsByVenue, category, now)) {
          trustedCommunity.set(venueId, price);
        }
      }
    } catch {
      // A community read failure cannot invalidate an independently readable listing.
    }
  }

  const listedByVenue = new Map<string, Promise<ReturnType<typeof listedCategoryPrices>>>();
  const listedForVenue = (venueId: string, serving: string | null): Promise<ReturnType<typeof listedCategoryPrices>> => {
    const key = JSON.stringify([venueId, serving]);
    const existing = listedByVenue.get(key);
    if (existing) return existing;
    const pending = ukPriceBundleRowsFor(venueId)
      .then((bundle) => bundle.status === "ready" ? listedCategoryPrices(bundle.rows, now, { serving }) : [])
      .catch(() => []);
    listedByVenue.set(key, pending);
    return pending;
  };

  return Promise.all(targets.map(async (stop, position) => {
    const hint = requested[position];
    if (!hint || (contextAbsent ? hint.source !== "listed" : hint.category !== category)) return { ...stop };
    if (hint.source === "community") {
      const price = trustedCommunity.get(stop.venueId);
      if (!price || price.source !== "community" || typeof price.submittedAt !== "number") return { ...stop };
      const serverEvidence = selectedDrinkPriceEvidenceForPrice(price, context!);
      return serverEvidence?.source === "community" && serverEvidence.pence === hint.pence && serverEvidence.reportedAt === hint.reportedAt
        ? { ...stop, selectedDrinkPriceEvidence: serverEvidence }
        : { ...stop };
    }
    if (!listedRequested || hint.source !== "listed") return { ...stop };

    const quote = (await listedForVenue(stop.venueId, hint.serving)).find((candidate) =>
      candidate.category === hint.category
      && Math.round(candidate.priceGbp * 100) === hint.pence
      && candidate.servingSize === hint.serving
      && candidate.sourceUrl === hint.sourceUrl
      && candidate.observedAt === hint.observedAt,
    );
    if (!quote) return { ...stop };
    const serverEvidence = cleanSelectedDrinkPriceEvidence({
      category: quote.category,
      pence: Math.round(quote.priceGbp * 100),
      serving: quote.servingSize,
      source: "listed",
      sourceUrl: quote.sourceUrl,
      observedAt: quote.observedAt,
    });
    return serverEvidence?.source === "listed"
      ? { ...stop, selectedDrinkPriceEvidence: serverEvidence }
      : { ...stop };
  }));
}

/** Backups use the same current server authority as the selected route. */
export async function resolvePlanSelectedDrinkPriceEvidence(
  stops: readonly PlanStopTarget[],
  submitted: readonly unknown[],
  rawContext: unknown,
): Promise<PricedPlanStopTarget[]> {
  const flattened = stops.flatMap((stop) => [stop, ...(stop.alternatives ?? [])]);
  const hints = stops.flatMap((stop, position) => {
    const raw = submitted[position];
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const alternatives = Array.isArray(row.alternatives) ? row.alternatives : [];
    return [row, ...(stop.alternatives ?? []).map((_, index) => alternatives[index])];
  });
  const priced = await resolvePriceEvidence(flattened, hints, rawContext);
  let offset = 0;
  return stops.map((stop) => {
    const primary = priced[offset++];
    const alternatives = (stop.alternatives ?? []).map(() => priced[offset++]);
    return { ...primary, ...(alternatives.length ? { alternatives } : {}) };
  });
}
