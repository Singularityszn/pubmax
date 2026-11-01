import type { Metadata, Route } from "next";
import { priceBand } from "@/lib/priceBand";
import Link from "next/link";

import { formatPrice } from "@/lib/venues";
import {
  getBoroughHeritageCounts,
  getBoroughSummaries,
} from "@/lib/boroughIndex.server";
import PriceBadge from "@/components/PriceBadge";
import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/ui/empty-state";
import { RowList, RowListItem } from "@/components/ui/row-list";
import BoroughScreen from "./BoroughScreen";

import "@/components/listing/listing.css";
import "./[slug]/borough.css";

// Borough index: /borough. A SERVER component listing every London borough in
// the dataset as ONE list read down the page (taste plan, 18 Oct 2026): name,
// pub count and historic count as quiet meta, the cheapest pint at the end of
// the row. It was a grid of 33 identical cards that left holes beside the last
// row and ran 33 tall cards down a phone. Each row links to its own
// /borough/[slug] page (cc_plan2 §14/§25). Shareable via generateMetadata.
// Reuses the detail page's stylesheet so both surfaces stay visually identical.

export const metadata: Metadata = {
  title: "London pubs by borough",
  description:
    "Browse London's pubs the way locals do, by area. Camden, Soho, Hackney and every borough on the map, ranked by the cheapest pint.",
  alternates: { canonical: "/borough" },
  openGraph: {
    title: "London pubs by borough: PUBMAXX",
    description:
      "Browse London's pubs by area. Every borough on the map, ranked by the cheapest pint.",
    type: "website",
  },
};

// Both reads are memoized per process by lib/boroughIndex.server: this page
// prints two derivations of bundled, build-time-constant data, so re-reading and
// re-grouping 6.7 MB of price rows on every request bought nothing. Neither
// loader throws — a failed read yields an empty table and the index renders its
// empty state rather than 500-ing.
export default async function BoroughIndexPage() {
  const boroughs = await getBoroughSummaries();
  // Cited historic-pub count per borough (borough-heritage rollup, Wave H).
  // Additive: named in the row's meta only where a borough has any on record.
  const heritageCounts = await getBoroughHeritageCounts();

  return (
    <main id="main" className="boroughPage listingShell">
      <SiteNav active="borough" />

      <BoroughScreen
        kicker="London"
        title="London, by the area you drink in."
        titleId="boroughHeading"
        lede={
          <>
            Nobody says &quot;let&rsquo;s go to the pub in Greater London.&quot;
            They say Camden, or Soho, or Hackney. Pick a borough and see its pubs
            ranked by the cheapest pint on the map.
          </>
        }
        mapHref="/map"
        mapLabel="Open the map"
      >
        {boroughs.length === 0 ? (
          <EmptyState
            className="boroughEmpty"
            title="We couldn’t load the boroughs just now."
            action={<Link prefetch={false} href="/map">Open the map instead</Link>}
          />
        ) : (
          <RowList label="London boroughs" className="boroughRows listingRead">
            {boroughs.map((borough) => {
              const historic = heritageCounts.get(borough.slug) ?? 0;
              return (
                <RowListItem
                  key={borough.slug}
                  className="boroughRow"
                  href={`/borough/${borough.slug}` as Route}
                  title={borough.name}
                  meta={
                    <>
                      {borough.pubCount} {borough.pubCount === 1 ? "pub" : "pubs"}
                      {historic > 0 ? <>, {historic} historic</> : null}
                    </>
                  }
                  trailing={
                    borough.cheapestGbp === null ? (
                      <span className="listingNoFigure">No price yet</span>
                    ) : (
                      <>
                        <span className="listingFrom">from</span>
                        <PriceBadge variant="current" band={priceBand(borough.cheapestGbp, { city: "london" })}>
                          {formatPrice(borough.cheapestGbp)}
                        </PriceBadge>
                      </>
                    )
                  }
                />
              );
            })}
          </RowList>
        )}
      </BoroughScreen>
    </main>
  );
}
