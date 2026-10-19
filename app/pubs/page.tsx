import type { Metadata } from "next";
import Link from "next/link";

import PubsGallery from "@/components/pubs/PubsGallery";
import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import {
  countScrapedPubsBySource,
  type ScrapedPubSourceId,
} from "@/lib/scrapedPubs";
import { readScrapedPubsForPage } from "@/lib/scrapedPubs.server";
import { paginateIndexRows, parsePubsFilterQuery } from "@/lib/pageFilters";
import { venueMatchesZone, ZONE_IDS } from "@/lib/zones";

import "@/components/listing/listing.css";
import "@/components/pubs/pubsGallery.css";

const CHAINS_DESCRIPTION =
  "London pubs from Young's, Nicholson's and Greene King whose menus we have checked. Each card opens the pub on the map.";

// The heading names what the page is for a reader, and the count rides under
// it in the lede, where a figure reads as a fact rather than an admin tally.
// A count is printed only when the chain read was complete: a partial read has
// no honest total.
const PUBS_HEADING = "Pub chains in London";

function pubsSubtitle(count: number | null): string {
  const chains = "Young's, Nicholson's and Greene King";
  return count === null
    ? `${chains} pubs whose menus we've checked.`
    : `${count} ${chains} pubs whose menus we've checked.`;
}

export async function generateMetadata(): Promise<Metadata> {
  const pageTitle = PUBS_HEADING;
  return {
    title: pageTitle,
    description: CHAINS_DESCRIPTION,
    alternates: { canonical: "/pubs" },
    openGraph: {
      title: appPageTitle(pageTitle),
      description: CHAINS_DESCRIPTION,
      url: "/pubs",
      siteName: metadataSiteName(),
      type: "website",
      images: ["/og.png"],
    },
  };
}

type PubsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PubsPage({
  searchParams,
}: PubsPageProps) {
  const { pubs, complete } = await readScrapedPubsForPage();
  const count = complete ? pubs.length : null;
  const filters = parsePubsFilterQuery((await searchParams) ?? {});
  const sourceCounts = countScrapedPubsBySource(pubs);
  const counts = {
    all: pubs.length,
    ...sourceCounts,
  };
  const zonesPresent = ZONE_IDS.filter((zone) =>
    pubs.some((pub) => pub.zone === zone),
  );
  const matchingPubs = pubs.filter(
    (pub) =>
      (filters.source === "all" || pub.source === filters.source) &&
      venueMatchesZone(pub.zone, filters.zone ?? "all"),
  );
  const pageResult = paginateIndexRows(matchingPubs, filters.page);

  return (
    <main id="main" className="pubsShell listingShell">
      <SiteNav active="pubs" />
      {/* The route's head is the launch Screen (docs/design/LAUNCH_SCREENS.md).
          The heading says what the page is, the pub chains whose menus we
          have checked rather than every pub, and the lede carries the count
          and names the three chains.

          Both way-onward destinations PREFETCH NOTHING. Next prefetches a
          Link on sight, and on a production build this page asked for /map,
          /near and two /map?sel= payloads before a reader had touched
          anything, pulling those routes' own chunks in front of this page's
          answer. That is the rule components/nav/IntentLink states, stated
          the one way a server component can state it. */}
      <Screen
        as="section"
        kicker="Pubs"
        title={PUBS_HEADING}
        titleId="pubs-title"
        lede={pubsSubtitle(count)}
        primary={<Link href="/map" prefetch={false}>Open the map</Link>}
        secondary={<Link href="/near" prefetch={false}>Find my pint</Link>}
      >
        <PubsGallery
          pubs={pageResult.rows}
          matchingPubs={matchingPubs.length}
          filter={filters.source as "all" | ScrapedPubSourceId}
          zone={filters.zone ?? "all"}
          counts={counts}
          zonesPresent={zonesPresent}
          page={pageResult.page}
          totalPages={pageResult.totalPages}
          complete={complete}
        />
      </Screen>
    </main>
  );
}
