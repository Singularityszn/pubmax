import type { Metadata } from "next";
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
import BoroughScreen from "./BoroughScreen";

import "./[slug]/borough.css";

// Borough index: /borough. A SERVER component listing every London borough in
// the dataset as a card (name, pub count, cheapest pint), each linking to its
// own /borough/[slug] page (cc_plan2 §14/§25). Shareable via generateMetadata.
// Reuses the detail page's stylesheet so both surfaces stay visually identical.

export const metadata: Metadata = {
  title: "London pubs by borough: PUBMAXXING",
  description:
    "Browse London's pubs the way locals do, by area. Camden, Soho, Hackney and every borough on the map, ranked by the cheapest pint.",
  alternates: { canonical: "/borough" },
  openGraph: {
    title: "London pubs by borough: PUBMAXXING",
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
  // Additive: shown as a subtle badge only where a borough has any on record.
  const heritageCounts = await getBoroughHeritageCounts();

  return (
    <main id="main" className="boroughPage">
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
          <ul className="boroughGrid" aria-label="London boroughs">
            {boroughs.map((borough) => (
              <li key={borough.slug}>
                <Link className="boroughCard" href={`/borough/${borough.slug}`}>
                  <span className="boroughCardName">{borough.name}</span>
                  <span className="boroughCardMeta">
                    {borough.pubCount} {borough.pubCount === 1 ? "pub" : "pubs"}
                  </span>
                  {heritageCounts.get(borough.slug) ? (
                    <span className="boroughCardHistoric">
                      {heritageCounts.get(borough.slug)} historic
                    </span>
                  ) : null}
                  <span className="boroughCardPrice">
                    {borough.cheapestGbp === null ? (
                      <span className="boroughNoPrice">No price yet</span>
                    ) : (
                      <>
                        from{" "}
                        <PriceBadge variant="current" band={priceBand(borough.cheapestGbp, { city: "london" })}>
                          {formatPrice(borough.cheapestGbp)}
                        </PriceBadge>
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </BoroughScreen>
    </main>
  );
}
