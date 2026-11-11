import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import { formatObservedDate } from "@/lib/dataFreshness";
import { formatGbp } from "@/lib/formatGbp";
import type { SocialAlternatives } from "@/lib/socialAlternatives";

const UNAVAILABLE: SocialAlternatives = { crawls: [], prices: [], priceRead: "unavailable" };

export default function SocialLondonEmpty({ alternatives = UNAVAILABLE }: { alternatives?: SocialAlternatives }) {
  return (
    <div className="socialLondonEmpty">
      <section aria-labelledby="social-empty-crawls">
        <h3 id="social-empty-crawls">Choose a crawl</h3>
        {alternatives.crawls.length ? <ul className="socialAlternativeList">
          {alternatives.crawls.map((crawl) => <li key={crawl.href}>
            <Link prefetch={false} href={crawl.href}>{crawl.name}</Link>
            <span className="socialAlternativeMeta">{crawl.stops} stops, free to follow.</span>
          </li>)}
        </ul> : <Link prefetch={false} href="/crawls">Browse crawl routes</Link>}
      </section>
      <section aria-labelledby="social-empty-prices">
        <h3 id="social-empty-prices">Latest pint prices we hold</h3>
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
