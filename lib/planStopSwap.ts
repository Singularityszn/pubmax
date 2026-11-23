import { formatPence } from "@/lib/formatGbp";
import type { NightContext } from "@/lib/nightPlanning";
import { cleanPlanPintPrice, type PlanPintPriceFields } from "@/lib/planPintPrice";
import type { SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";

type SwapAlternative = PlanPintPriceFields & {
  venueId: string;
  venueName: string;
  selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence;
};

export type SwappableStop = SwapAlternative & {
  reason?: string;
  walkingMinutesFromPrevious?: number | null;
  walkFromVenueId?: string;
  alternatives: SwapAlternative[];
};

/** What the plan asked for. A confirmation names the one dearer pub the person agreed to. */
export type SwapAsk = { priceLed: boolean; confirmedVenueId?: string | null };

type PricedRow = {
  selectedDrinkPriceEvidence?: { pence: number } | null;
  estimatedPintPricePence?: number | null;
};

// Every alternative comes from the generator's list for the plan's own area.
const SWAPPED_IN_AREA_REASON = "Another pub the plan found in this area.";

/** A cheap ask or a budget makes price the rule a swap must keep. */
export function isPriceLedAsk(context: Partial<Pick<NightContext, "budget" | "budgetLimitPence">> | null): boolean {
  return Boolean(context && (context.budget === "value" || (context.budgetLimitPence ?? null) !== null));
}

/** The price a stop's card shows: the chosen drink's, or else the pint's. */
function swapPricePence(row: PricedRow): number | null {
  return row.selectedDrinkPriceEvidence?.pence ?? row.estimatedPintPricePence ?? null;
}

/** Priced pubs first, cheapest first. The sort is stable, so ties keep their order. */
export function byPriceThen<T extends PricedRow>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => (swapPricePence(left) ?? Infinity) - (swapPricePence(right) ?? Infinity));
}

type SwapChoice = { index: number; held: boolean } | null;

/**
 * The pub a swap takes. A price-led ask takes the cheapest priced pub at or under
 * the stop it replaces. With none, it holds the smallest rise until the person
 * confirms that pub by name. Any other ask takes the next pub in the list.
 */
function chooseSwap(stop: SwappableStop, excluded: ReadonlySet<string>, ask: SwapAsk): SwapChoice {
  const open = stop.alternatives.flatMap((alternative, index) => excluded.has(alternative.venueId) ? [] : [{ alternative, index }]);
  if (!open.length) return null;
  const current = swapPricePence(stop);
  if (!ask.priceLed) return { index: open[0]!.index, held: false };
  const ranked = byPriceThen(open.map(({ alternative, index }) => ({ ...alternative, index })));
  const fits = ranked.find((row) => {
    const price = swapPricePence(row);
    return price !== null && (current === null || price <= current);
  });
  if (fits) return { index: fits.index, held: false };
  const next = ranked[0]!;
  return { index: next.index, held: current !== null && ask.confirmedVenueId !== next.venueId };
}

/** Swap to the chosen pub and keep the old one swappable. A held swap returns the stop unchanged. */
export function swapDraftStop<S extends SwappableStop>(
  stop: S,
  excludedVenueIds: ReadonlySet<string> = new Set(),
  ask: SwapAsk = { priceLed: false },
): S {
  const choice = chooseSwap(stop, excludedVenueIds, ask);
  if (!choice || choice.held) return stop;
  const next = stop.alternatives[choice.index];
  if (!next) return stop;
  return {
    ...stop,
    venueId: next.venueId,
    venueName: next.venueName,
    reason: stop.reason ? SWAPPED_IN_AREA_REASON : undefined,
    selectedDrinkPriceEvidence: next.selectedDrinkPriceEvidence,
    // The walk to and from this stop was measured for the old pub, so it goes;
    // the price was the generator's for this pub, so it comes with it.
    walkingMinutesFromPrevious: undefined,
    walkFromVenueId: undefined,
    estimatedPintPricePence: undefined,
    priceKind: undefined,
    pintPriceEvidence: undefined,
    ...cleanPlanPintPrice(next.venueId, next, "stored"),
    alternatives: [
      ...stop.alternatives.filter((_, index) => index !== choice.index),
      {
        venueId: stop.venueId,
        venueName: stop.venueName,
        ...(stop.selectedDrinkPriceEvidence ? { selectedDrinkPriceEvidence: stop.selectedDrinkPriceEvidence } : {}),
        ...cleanPlanPintPrice(stop.venueId, stop, "stored"),
      },
    ],
  };
}

/** The one honest line for a swap that waits on the person, or null when nothing waits. */
export function heldSwapLine(
  stop: SwappableStop,
  excludedVenueIds: ReadonlySet<string>,
  ask: SwapAsk,
): { venueId: string; line: string } | null {
  const choice = chooseSwap(stop, excludedVenueIds, ask);
  const next = choice?.held ? stop.alternatives[choice.index] : undefined;
  if (!next) return null;
  const price = swapPricePence(next);
  const current = swapPricePence(stop);
  const cost = price === null || current === null
    ? `${next.venueName} has no price yet.`
    : `${next.venueName} is ${formatPence(price)}, ${formatPence(price - current)} more.`;
  return { venueId: next.venueId, line: `No cheaper pub fits nearby. ${cost} Swap again to take it.` };
}

/** What a done swap did to the price, said after the pub's name. Empty when nothing to say. */
export function swapPriceNote(before: SwappableStop, after: SwappableStop): string {
  const was = swapPricePence(before);
  const now = swapPricePence(after);
  if (was === null) return "";
  if (now === null) return ", which has no price yet";
  if (now === was) return "";
  const unit = after.selectedDrinkPriceEvidence ? "a drink" : "a pint";
  return `, ${formatPence(Math.abs(now - was))} ${now > was ? "more" : "less"} ${unit}`;
}
