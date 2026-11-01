import { formatGbp } from "@/lib/formatGbp";
import type { DryRoundStopPrices } from "@/lib/dryRound";
import { nearDrinkMeasureLabel } from "@/lib/nearCheapestAnything";
import { nearPriceTrustLabel } from "@/lib/nearPriceTrust";

import "./planDryRoundLedger.css";

function alcoholFreeSource(prices: DryRoundStopPrices): string {
  const { publisher, observedOn } = prices.alcoholFree;
  const readAt = observedOn ? `${observedOn}T12:00:00Z` : null;
  return publisher
    ? nearPriceTrustLabel("named", publisher, readAt)
    : nearPriceTrustLabel("unrecorded", null, readAt);
}

/**
 * The dry round under its stops (lib/dryRound.ts): each stop's listed
 * alcohol-free price, with the drink's own name, its measure and its source,
 * and the listed pint beside it. Both figures stay in ink, because colour on a
 * price is the pint band and an alcohol-free drink has none. A pub with no
 * listed alcohol-free price, one added by hand, says so on its own row.
 */
export default function PlanDryRoundLedger({
  stops,
  prices,
}: {
  stops: readonly { venueId: string; venueName: string }[];
  prices: ReadonlyMap<string, DryRoundStopPrices>;
}) {
  if (stops.length === 0) return null;
  return (
    <section className="planDryRound" aria-labelledby="plan-dry-round-title" data-testid="plan-dry-round">
      <h2 id="plan-dry-round-title" className="planDryRound__title">Your dry round</h2>
      <p className="planDryRound__lede">Each stop&apos;s listed alcohol-free price, with its pint price beside it.</p>
      <ol className="planDryRound__rows">
        {stops.map((stop, index) => {
          const entry = prices.get(stop.venueId);
          return (
            <li key={`${index}-${stop.venueId}`} className="planDryRound__row">
              <span className="planDryRound__stop">{index + 1}. {stop.venueName}</span>
              {entry ? (
                <>
                  <span className="planDryRound__line">
                    <span className="planDryRound__kind">Alcohol-free</span>{" "}
                    <span className="planDryRound__price">{formatGbp(entry.alcoholFree.priceGbp)}</span>{" "}
                    <span className="planDryRound__drink">
                      {entry.alcoholFree.drinkLabel ?? "Drink not named"} · {nearDrinkMeasureLabel(entry.alcoholFree.measure)}
                    </span>
                  </span>
                  <span className="planDryRound__read">{alcoholFreeSource(entry)}</span>
                  <span className="planDryRound__line">
                    <span className="planDryRound__kind">Pint</span>{" "}
                    {entry.pint ? (
                      <>
                        <span className="planDryRound__price">{formatGbp(entry.pint.pence / 100)}</span>{" "}
                        <span className="planDryRound__read">
                          {nearPriceTrustLabel("named", entry.pint.publisher, entry.pint.observedAt)}
                        </span>
                      </>
                    ) : (
                      <span className="planDryRound__read">No listed pint price</span>
                    )}
                  </span>
                </>
              ) : (
                <span className="planDryRound__read">No listed alcohol-free price for this pub.</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
