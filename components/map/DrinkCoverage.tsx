import type { CoffeePilotStatus } from "@/lib/coffeePilot";
import { drinkLaneNoun } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";
import type { DrinkCoverageCount } from "@/lib/drinkCoverage";

export type MapDrinkCoverage = DrinkCoverageCount & {
  coffeePilot?: { count: number; status: CoffeePilotStatus };
};

export default function DrinkCoverage({ category, coverage, coffeePilot = coverage.coffeePilot }: {
  category: DrinkCategory;
  coverage: MapDrinkCoverage;
  coffeePilot?: MapDrinkCoverage["coffeePilot"];
}) {
  const noun = category === "beer" ? "pint" : drinkLaneNoun(category);
  const pending = coverage.status === "idle" || coverage.status === "loading";
  return (
    <div className="drinkLanePickerNote" aria-label="Price coverage" role="status">
      {coverage.status === "degraded" ? <p>We could not read the {noun} prices just now.</p> : pending ? <p>Checking {noun} prices for the pubs loaded on this map.</p> : <>
        <p><strong>{coverage.count.toLocaleString("en-GB")} of {coverage.total.toLocaleString("en-GB")} loaded pubs</strong> have {category === "beer" ? "a pint price on record" : `a confirmed ${noun} price`}.</p>
        {coverage.status === "partial" ? <p>Some prices are still missing from this count.</p> : null}
      </>}
      <p>This counts the pubs loaded so far, not every pub in the city.</p>
      {coffeePilot ? <p>{coffeePilot.status === "ready"
        ? `The Shoreditch coffee list also has ${coffeePilot.count} cafés with listed prices.`
        : coffeePilot.status === "failed" ? "The Shoreditch café prices could not be read."
          : "Checking the Shoreditch café prices."}</p> : null}
    </div>
  );
}
