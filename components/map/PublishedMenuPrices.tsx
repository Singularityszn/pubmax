import { CATEGORY_META } from "@/lib/drinks";
import { formatPrice } from "@/lib/formatGbp";
import type { ListedCategoryPrice } from "@/lib/listedCategoryPrices";

import "./venueDrinkPrices.css";

const listedDayFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export default function PublishedMenuPrices({
  prices,
  unavailable,
  loading = false,
}: {
  prices: readonly ListedCategoryPrice[];
  unavailable: boolean;
  loading?: boolean;
}) {
  if (loading) {
    return <p className="venueListedPriceUnavailable" role="status">Checking published menu prices.</p>;
  }
  if (unavailable) {
    return (
      <p className="venueListedPriceUnavailable" role="status">
        Published menu prices unavailable just now.
      </p>
    );
  }
  if (prices.length === 0) return null;

  return (
    <div className="venueListedPrices">
      <h3>Prices on published menus</h3>
      <ul className="venueDrinkPricesList">
        {prices.map((quote, index) => (
          <li key={`${quote.category}-${quote.sourceUrl}-${index}`} className="venueListedPriceRow">
            <span className="venueDrinkPriceTag">
              {CATEGORY_META[quote.category].label}
              {quote.drinkLabel && quote.drinkLabel !== CATEGORY_META[quote.category].label
                ? ` · ${quote.drinkLabel}`
                : null}
            </span>
            <span className="venueDrinkPriceFigure">{formatPrice(quote.priceGbp)}</span>
            <span className="venueListedPriceMeasure">
              {quote.servingSize || "Serving not recorded"}
            </span>
            <span className="venueListedPriceSource">
              Price seen {listedDayFormatter.format(new Date(quote.observedAt))} ·{" "}
              <a href={quote.sourceUrl} target="_blank" rel="noopener noreferrer">
                View menu source
              </a>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
