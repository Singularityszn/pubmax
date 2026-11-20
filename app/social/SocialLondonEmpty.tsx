import Link from "next/link";
import { useEffect, useState } from "react";

import PriceBadge from "@/components/PriceBadge";
import OpenTableCard from "@/components/social/OpenTableCard";
import { formatObservedDate } from "@/lib/dataFreshness";
import type { FeaturedOpenTableResult } from "@/lib/featuredOpenTable.server";
import { formatGbp } from "@/lib/formatGbp";
import type { SocialAlternatives } from "@/lib/socialAlternatives";
import { joinableThisWeek, parseOpenCrawlListing } from "@/lib/openCrawl";

const UNAVAILABLE: SocialAlternatives = { crawls: [], prices: [], priceRead: "unavailable" };

export default function SocialLondonEmpty({
  alternatives = UNAVAILABLE,
  openTable,
}: {
  alternatives?: SocialAlternatives;
  openTable?: FeaturedOpenTableResult;
}) {
  const [hasOpenCrawls, setHasOpenCrawls] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/open-crawls", { signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as { status?: string; crawls?: unknown } : null)
      .then((body) => {
        if (controller.signal.aborted || body?.status !== "ready" || !Array.isArray(body.crawls)) return;
        const crawls = body.crawls.map(parseOpenCrawlListing).filter((crawl) => crawl !== null);
        setHasOpenCrawls(joinableThisWeek(crawls, Date.now()).length > 0);
      }).catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <div className="socialLondonEmpty">
      {openTable?.status === "upcoming" ? <OpenTableCard table={openTable.table} /> : hasOpenCrawls ? (
        <section className="socialOpenTable" aria-labelledby="social-open-table">
          <p className="socialOpenTableKicker">Open Table</p>
          <h2 id="social-open-table">Find a crawl to join</h2>
          <p>Meet other pub-goers on an open crawl.</p>
          {openTable?.status === "unavailable" ? (
            <p className="socialAlternativeMeta">We couldn&apos;t check this week&apos;s featured night or its places just now.</p>
          ) : null}
          <Link className="socialOpenTableAction" prefetch={false} href="/crawls">Explore open crawls</Link>
        </section>
      ) : null}
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
