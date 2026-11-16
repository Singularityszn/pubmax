import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import { formatObservedDate } from "@/lib/dataFreshness";
import { formatGbp } from "@/lib/formatGbp";
import type { SocialAlternatives } from "@/lib/socialAlternatives";

const UNAVAILABLE: SocialAlternatives = { crawls: [], prices: [], priceRead: "unavailable" };

export default function SocialLondonEmpty({ alternatives = UNAVAILABLE }: { alternatives?: SocialAlternatives }) {
  return (
    <div className="socialLondonEmpty">
      <section className="socialOpenTable" aria-labelledby="social-open-table">
        <p className="socialOpenTableKicker">Open Table</p>
        <h2 id="social-open-table">Find a crawl to join</h2>
        <p>Meet other pub-goers on an open crawl.</p>
        <Link className="socialOpenTableAction" prefetch={false} href="/crawls">Explore open crawls</Link>
      </section>
      <section aria-labelledby="social-empty-prices">
        <h2 id="social-empty-prices">Latest pint prices we hold</h2>
        {alternatives.prices.length ? <ul className="socialAlternativeList">
          {alternatives.prices.map((price) => <li key={price.venueId}>
            <Link prefetch={false} href={price.href}>{price.name}</Link>
            <span className="socialAlternativeMeta">
              {price.drink}, {price.serving}{" · "}
              <PriceBadge variant="current" band={null}>{formatGbp(price.priceGbp)}</PriceBadge>
            </span>
            <span className="socialAlternativeSource">
              Listed by <a href={price.publisher.url} target="_blank" rel="noopener noreferrer">{price.publisher.label}</a>
              {", read "}<time dateTime={price.observedOn}>{formatObservedDate(new Date(`${price.observedOn}T12:00:00Z`))}</time>.
            </span>
          </li>)}
        </ul> : <p className="socialAlternativeMeta">
          {alternatives.priceRead === "unavailable"
            ? "We could not read the listed prices."
            : "No dated menu prices to show here yet."}
        </p>}
        <Link className="socialAlternativeBrowse" prefetch={false} href="/pubs">Browse pubs and prices</Link>
      </section>
    </div>
  );
}
