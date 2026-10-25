import { useEffect, useState } from "react";
import { loadedListedDrinkCoverage } from "@/lib/listedMapDrinkCoverage";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import type { CoffeePilotStatus } from "@/lib/coffeePilot";
import { drinkLaneNoun } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";
import type { DrinkCoverageCount } from "@/lib/drinkCoverage";

export type MapDrinkCoverage = DrinkCoverageCount & {
  loadedPubIds?: readonly string[];
  coffeePilot?: { count: number; status: CoffeePilotStatus };
};

export default function DrinkCoverage({ category, coverage }: {
  category: DrinkCategory;
  coverage: MapDrinkCoverage;
}) {
  const [listingRead, setListingRead] = useState<{ rows: unknown; status: "loading" | "ready" | "failed" }>({ rows: null, status: "loading" });
  const showsListed = category === "coffee" || category === "alcohol-free";
  const hasLoadedPubIds = coverage.loadedPubIds !== undefined;
  useEffect(() => {
    if (!showsListed || !hasLoadedPubIds) return;
    const controller = new AbortController();
    void loadSurfaceJson<unknown>("/data/uk_prices/listed_coverage.json", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      freshForMs: 5 * 60_000,
      validate: (rows) => { loadedListedDrinkCoverage(rows, [], "coffee"); return true; },
    }, (rows) => { setListingRead({ rows, status: "ready" }); }).then((status) => {
      if (status === "failed" && !controller.signal.aborted) setListingRead({ rows: null, status: "failed" });
    });
    return () => controller.abort();
  }, [showsListed, hasLoadedPubIds]);
  const listed = listingRead.status === "ready" ? loadedListedDrinkCoverage(listingRead.rows, coverage.loadedPubIds ?? [], category) : null;
  const coffeePilot = coverage.coffeePilot;
  const noun = category === "beer" ? "pint" : drinkLaneNoun(category);
  const pending = coverage.status === "idle" || coverage.status === "loading";
  return (
    <div className="drinkLanePickerNote" aria-label="Price coverage" role="status">
      {coverage.status === "degraded" ? <p>We could not read the {noun} prices just now.</p> : pending ? <p>Checking {noun} prices for the pubs loaded on this map.</p> : <>
        <p><strong>{coverage.count.toLocaleString("en-GB")} of {coverage.total.toLocaleString("en-GB")} loaded pubs</strong> have {category === "beer" ? "a pint price on record" : `a confirmed ${noun} price`}.</p>
        {coverage.status === "partial" ? <p>Some prices are still missing from this count.</p> : null}
      </>}
      {showsListed && coverage.loadedPubIds ? <p>{listed
        ? `${listed.count.toLocaleString("en-GB")} loaded ${listed.count === 1 ? "pub has" : "pubs have"} a listed ${noun} price from a published menu.${listed.newest ? ` Latest source read: ${new Date(listed.newest).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.` : ""} Listed prices are separate from drinker confirmations. Menus can change.`
        : listingRead.status === "failed" ? "Listed menu coverage could not be read." : "Checking listed menu coverage."}</p> : null}
      <p>This counts the pubs loaded so far, not every pub in the city.</p>
      {coffeePilot ? <p>{coffeePilot.status === "ready"
        ? `The Shoreditch coffee list also has ${coffeePilot.count} cafés with listed prices.`
        : coffeePilot.status === "failed" ? "The Shoreditch café prices could not be read."
          : "Checking the Shoreditch café prices."}</p> : null}
    </div>
  );
}
