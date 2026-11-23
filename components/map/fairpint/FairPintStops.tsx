import type { FairPintGenerated } from "@/lib/fairPint";
import { priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
import { categoryLabel, isDrinkCategory } from "@/lib/drinks";
import { formatPence } from "@/lib/formatGbp";
import PriceSourceName from "@/components/venue/PriceSourceName";

export function listedFairPintStops(stops: FairPintGenerated["stops"]) {
  return stops.map((stop) => ({
    ...stop,
    listed: stop.priceEvidence && priceEvidenceUsableForCeiling(stop.priceEvidence) && stop.priceServing === "pint"
      ? stop.priceEvidence
      : null,
  }));
}

export default function FairPintStops({ stops }: { stops: ReturnType<typeof listedFairPintStops> }) {
  return (
    <ol className="fairPintStops">
      {stops.map((stop) => {
        const price = stop.listed;
        return (
          <li key={stop.venueId}>
            <strong>{stop.venueName}</strong>
            {price?.source && price.pence != null ? (
              <>
                <span>{isDrinkCategory(stop.priceCategory) ? categoryLabel(stop.priceCategory) : "Pint"} · pint · {formatPence(price.pence)}</span>
                <span><PriceSourceName label={price.source.label} url={price.source.url} /></span>
                <span>Read {new Date(price.source.observedAt).toLocaleDateString("en-GB", {
                  timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric",
                })}</span>
              </>
            ) : <span>No listed price</span>}
          </li>
        );
      })}
    </ol>
  );
}
