import Link from "next/link";
import PriceSourceName from "@/components/venue/PriceSourceName";
import { useEffect, useState } from "react";

import PriceBadge from "@/components/PriceBadge";
import OpenTableCard from "@/components/social/OpenTableCard";
import Kicker from "@/components/ui/kicker";
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
  const [crawlRead, setCrawlRead] = useState<"loading" | "available" | "empty" | "preview" | "unavailable">("loading");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/open-crawls", { signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as { status?: string; crawls?: unknown } : null)
      .then((body) => {
        if (controller.signal.aborted) return;
        if (body?.status === "preview") {
          setCrawlRead("preview");
          return;
        }
        if (body?.status !== "ready" || !Array.isArray(body.crawls)) {
          setCrawlRead("unavailable");
          return;
        }
        const crawls = body.crawls.map(parseOpenCrawlListing).filter((crawl) => crawl !== null);
        setCrawlRead(crawls.length !== body.crawls.length
          ? "unavailable"
          : joinableThisWeek(crawls, Date.now()).length > 0 ? "available" : "empty");
      }).catch(() => {
        if (!controller.signal.aborted) setCrawlRead("unavailable");
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="socialLondonEmpty">
      {crawlRead === "preview" ? null : openTable?.status === "upcoming" ? <OpenTableCard table={openTable.table} /> : crawlRead !== "empty" ? (
        <section className="socialOpenTable" aria-labelledby="social-open-table">
          <Kicker>Open crawls</Kicker>
          <h2 id="social-open-table">Find a crawl to join</h2>
          <p>Meet other pub-goers on a night out.</p>
          {crawlRead === "unavailable" ? (
            <p className="socialAlternativeMeta">We couldn&apos;t check open crawls just now.</p>
          ) : null}
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
              Listed by <PriceSourceName label={price.publisher.label} url={price.publisher.url} />
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
