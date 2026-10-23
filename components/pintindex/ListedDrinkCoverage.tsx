import Link from "next/link";
import type { ListedDrinkCoverage as Coverage } from "@/lib/listedDrinkCoverage";
import { drinkLaneLabel } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";

const CATEGORIES: readonly DrinkCategory[] = ["beer", "coffee", "alcohol-free", "wine", "cocktail", "soft-drink"];

export default function ListedDrinkCoverage({ coverage, status }: {
  coverage: Coverage;
  status: "ready" | "partial" | "degraded";
}) {
  return <section className="pintIndexSection" aria-labelledby="drinkCoverageHeading">
    <h2 id="drinkCoverageHeading" className="listingSectionTitle">How much of our pub list has a price?</h2>
    {status === "degraded" ? <p className="listingSectionDek">We could not read the pub list just now. Coverage is unavailable.</p> : <>
      <p className="listingSectionDek"><strong>{coverage.pricedPubs.toLocaleString("en-GB")} of {coverage.total.toLocaleString("en-GB")} pubs</strong> in our London pub list have a pint price on record{status === "ready" && coverage.total > 0 ? ` (${Math.round(coverage.pricedPubs / coverage.total * 100)}%)` : ""}.</p>
      <p className="listingSectionDek">The total is our pub list, not every pub in London. These are listed prices, not a promise of today&rsquo;s price. Each pub counts once per drink.</p>
      {status === "partial" ? <p role="status" className="listingSectionDek">Some menu prices could not be read. The drink counts below are incomplete.</p> : null}
      <dl className="pintIndexStats">
        {CATEGORIES.map((category) => <div className="pintIndexStat" key={category}>
          <dt>{drinkLaneLabel(category)}</dt>
          <dd>{coverage.counts[category].toLocaleString("en-GB")}<small>of {coverage.total.toLocaleString("en-GB")} pubs</small></dd>
        </div>)}
      </dl>
      <p className="listingSectionDek">These counts are separate from the borough league and its CSV. Cafés are outside this pub count. The map&rsquo;s coffee list counts them separately. Map drink colours use confirmed prices from drinkers.</p>
      <Link href="/map?drink=coffee" className="listingLink">See coffee on the map</Link>
    </>}
  </section>;
}
