import type { Route } from "next";
import type { Metadata } from "next";
import { appPageTitle } from "@/lib/brandNaming";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import Link from "next/link";
import { notFound } from "next/navigation";

import JsonLd from "@/components/seo/JsonLd";
import FactBlock from "@/components/seo/FactBlock";
import FaqBlock from "@/components/seo/FaqBlock";
import PriceBadge from "@/components/PriceBadge";
import {
  venueBundlePrices,
  venuePriceLane,
  venueSourcedPrice,
} from "@/lib/venuePriceLane";
import { venueMapUrl } from "@/lib/venueIndex";
import { pintFactStats, faqItems, faqPageJsonLd } from "@/lib/pintFacts";
import {
  formatMonthYear,
  formatObservedDate,
  PINT_DATASET_OBSERVED_AT,
} from "@/lib/dataFreshness";
import { formatPrice, type Venue } from "@/lib/venues";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { boroughFromSlug, pubsInBorough, slugifyBorough } from "@/lib/boroughs";
import { boroughPlacePhoto, londonPlacePhoto } from "@/components/listing/placePhotoRules";
import { loadBoroughHeritage, NOTABLE_CAP } from "@/lib/boroughHeritage";
import { boroughNamedRouteLinks, boroughNightAreaLinks } from "@/lib/boroughNeighbourhoodLinks";
import { curatedCrawlMapHref, curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/ui/empty-state";
import { RowList, RowListItem } from "@/components/ui/row-list";
import { displayDrinkName, plainDashes } from "@/components/listing/displayCase";
import BoroughScreen from "../BoroughScreen";
import BoroughPassportSlice from "@/components/borough/BoroughPassportSlice";
import BoroughPintPriceCard from "@/components/borough/BoroughPintPriceCard";
import AreaNewsList from "@/components/areanews/AreaNewsList";
import { entriesForBorough, freshAreaNews, NEW_ROUND_HERE_CAP } from "@/lib/areaNews";
import { loadAreaNews } from "@/lib/areaNews.server";

import "@/components/listing/listing.css";
import "./borough.css";
import "@/components/seo/factLayer.css";

// Borough discovery / "night-out chapter" page: /borough/[slug]. A SERVER
// component (cc_plan2 §14/§25, story 28) — it reads the bundled dataset through
// lib/pintPriceLandingDataset.server, the ONE governed seam every priced surface
// shares, resolves the borough from the slug, and renders a
// shareable page: a dek, cheapest-first pubs (each linking onto the map), the
// borough's story pubs, any curated/themed crawl that touches the borough, and
// a transport hint that links the map pre-filtered to the area. generateMetadata
// gives it a share-worthy title/description. An unknown slug resolves to
// notFound() — the page never crashes on a borough that doesn't exist.
//
// Next 16 dynamic route params are async — `params` is a Promise we await.

type PageProps = { params: Promise<{ slug: string }> };

// THIS DOCUMENT IS PRERENDERED (task vercel-f2-seo-cdn, recorded in proxy.ts
// beside CDN_CACHED_DOCUMENT_ROUTES): it drops the per-request CSP nonce so the
// Vercel CDN can hold it. It renders only bundled data and reads no cookie, no
// header and no search param. `__tests__/cdnCachedDocuments.test.ts` holds
// both rules.
export const dynamic = "force-static";
// The price data changes only on a deploy and area news is dated by the day,
// so an hour is the same quiet ceiling
// `/map` takes: it bounds how long a stale copy can outlive a change nobody
// redeployed for.
export const revalidate = 3600;

// A curated/themed crawl "touches" a borough when at least one of its stops'
// primary/visible borough slugs matches the page's borough slug. Pure, reads
// only what's already loaded (no extra fetch) — a crawl with no matching stop
// just doesn't show up in the borough's chapter.
function crawlsTouchingBorough(
  crawls: CuratedCrawl[],
  venues: Venue[],
  slug: string,
): CuratedCrawl[] {
  const target = slugifyBorough(slug);
  if (!target) return [];
  const venueById = new Map(venues.map((venue) => [venue.id, venue]));
  return crawls.filter((crawl) =>
    crawl.venueIds.some((id) => {
      const venue = venueById.get(id);
      if (!venue) return false;
      return (
        slugifyBorough(venue.primaryBorough) === target ||
        venue.visibleBoroughs.some((borough) => slugifyBorough(borough) === target)
      );
    }),
  );
}

// The story pubs are a subset of the list above, so the section names a
// handful and counts the rest: Westminster printed 100 chips, a wall the
// reader had already scrolled past once (taste plan, 18 Oct 2026).
const STORY_CHIP_CAP = 12;

/** Borough floor for Outer London honesty banner (Wave H4 / PRD P1). */
const BOROUGH_COVERAGE_FLOOR = 15;

// Browse the borough on the clean map via search (`?q=`), so outer areas like
// Barnet open without resurrecting a hand-built crawl into the planner.
function boroughBrowseMapUrl(name: string): Route {
  const params = new URLSearchParams();
  params.set("q", name);
  return `/map?${params.toString()}`;
}

// The grouped venue set, through the ONE governed seam every priced surface
// reads. A loader of its own re-parsed and re-grouped 6.7 MB per render, and
// this route pays that twice (generateMetadata, then the page body). Never
// throws: a read failure yields [] so the page degrades to a friendly empty
// state rather than 500-ing.
async function loadVenues() {
  return loadPintPriceLandingVenues();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const venues = await loadVenues();
  const name = boroughFromSlug(slug, venues);

  if (!name) {
    return {
      title: "Borough",
      robots: { index: false, follow: false },
    };
  }

  // The layout's template adds the brand to the document title; the share
  // card is not templated, so it carries the brand itself.
  const title = `The cheapest pints and best pubs in ${name}`;
  const cardTitle = appPageTitle(title);
  const pubs = pubsInBorough(venues, slug);
  const cheapest = pubs.find((pub) => typeof pub.cheapestPrice === "number")?.cheapestPrice;
  const description =
    typeof cheapest === "number"
      ? `${pubs.length} pubs in ${name}, ranked cheapest-first. Pints from ${formatPrice(
          cheapest,
        )}. Plan a crawl through the area on PUBMAXX.`
      : `${pubs.length} pubs in ${name} on the map. Plan a crawl through the area on PUBMAXX.`;

  return {
    title,
    description,
    alternates: { canonical: `/borough/${slugifyBorough(name)}` },
    // opengraph-image.tsx sits beside this route, so Next auto-attaches the
    // dynamic borough card to both OG and Twitter. summary_large_image makes X
    // render it as the full 1200×630 card rather than a thumbnail.
    openGraph: {
      title: cardTitle,
      description,
      type: "website",
      url: `/borough/${slugifyBorough(name)}`,
    },
    twitter: { card: "summary_large_image", title: cardTitle, description },
  };
}

const SITE_URL = "https://pubmaxxing.com";

// BreadcrumbList + ItemList structured data for this borough (Wave S1.3). Both
// are built strictly from what the page already renders: the breadcrumb mirrors
// the on-page "Boroughs · London" trail, and the ItemList is the cheapest-first
// pub table. Each pub links to its canonical, crawlable venue permalink
// (/ledger/{id}) — nothing invented; a pub with no price still lists, priced or
// not, exactly as the table shows it.
// One pub's price cell. It asks `venuePriceLane` rather than testing
// `cheapestPrice` itself, so "No price" here means the ONE thing it means
// everywhere else: no lane answered (issue #1426). This page is server-rendered
// from bundled data and holds no Pint Drops, so its provisional argument is
// absent by construction; routing it through the precedence is what stops the
// borough list wording an absence the venue sheet has stopped wording.
function BoroughPubPrice({ pub }: { pub: Venue }) {
  const lane = venuePriceLane(
    pub,
    pub.latestContributorPrice,
    venueSourcedPrice(pub),
    venueBundlePrices(pub),
  );
  if (lane === null) return <span className="listingNoFigure">No price</span>;
  // The figure comes off the lane that won, never off `cheapestPrice` again:
  // a lane whose figure lives somewhere else would otherwise print a blank
  // badge here the day it starts answering on this page.
  const figure =
    lane.lane === "contributor"
      ? lane.contributorPrice
      : lane.lane === "listed"
        ? lane.listed.priceGbp
        : lane.lane === "provisional"
          ? lane.provisionalPrice
          : lane.lane === "estimate"
            ? lane.estimate.priceGbp
            : // anchor, sourced and baseline all print the venue's own figure;
              // the sourced lane carries provenance, not a price.
              pub.cheapestPrice;
  // The figure wears its price BAND (lib/priceBand.ts). An anchor is not a
  // pint, so it wears none.
  const band = lane.lane === "anchor" ? null : priceBand(figure, priceBandAreaForVenue(pub.id));
  return (
    <PriceBadge variant={lane.lane === "baseline" ? "baseline" : "current"} band={band}>
      {formatPrice(figure)}
    </PriceBadge>
  );
}

function boroughJsonLd(name: string, slug: string, pubs: Venue[]) {
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Boroughs", item: `${SITE_URL}/borough` },
      { "@type": "ListItem", position: 2, name, item: `${SITE_URL}/borough/${slug}` },
    ],
  };
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Pubs in ${name}`,
    numberOfItems: pubs.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: pubs.map((pub, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: pub.name,
      url: `${SITE_URL}/ledger/${pub.id}`,
    })),
  };
  return [breadcrumb, itemList];
}

export default async function BoroughPage({ params }: PageProps) {
  const { slug } = await params;
  const venues = await loadVenues();
  const name = boroughFromSlug(slug, venues);
  if (!name) notFound();

  const pubs = pubsInBorough(venues, slug);
  const storyPubs = pubs.filter((pub) => pub.hasStory);
  const touchingCrawls = crawlsTouchingBorough(curatedCrawls, venues, slug);
  // Soho, Shoreditch and the named route pages, linked from the borough that
  // holds them (SEO audit #2126, finding 17). No new area page is published.
  const neighbourhoodLinks = [
    ...boroughNightAreaLinks(slug, venues),
    ...boroughNamedRouteLinks(slug, venues),
  ];
  // Cheapest-first sort already applied by pubsInBorough — first numeric
  // price is our dataset's cheapest pint here. Used only for the CityMCP
  // card's optional "vs our map" one-liner.
  const ourCheapestPrice =
    pubs.find((pub) => typeof pub.cheapestPrice === "number")?.cheapestPrice ?? null;
  // Borough-heritage rollup (Wave H): cited historic pubs in this area. null
  // when the borough has none — the section then renders nothing (no empty box).
  const heritage = await loadBoroughHeritage(slug);

  // Programmatic fact layer (Wave S3.1/S3.2): stats derived from the tracked
  // pint prices already loaded above, stamped with the dataset's observation
  // date (honest freshness — never "live"). FAQ items skip any question whose
  // answer data is missing, so a price-less borough renders neither block.
  // Honest stamp: the dataset's collection date, not the bundled file's mtime.
  const observedAt = PINT_DATASET_OBSERVED_AT;
  const boroughSlug = slugifyBorough(name);

  // Fresh-facts layer (Cycle 15 Lane A): dated, sourced pub news for this
  // borough. Successful empty reads and unavailable reads stay distinct.
  const areaNewsRead = await loadAreaNews();
  const areaNews = areaNewsRead.status === "ready" ? entriesForBorough(
    boroughSlug,
    freshAreaNews(areaNewsRead.entries),
  ).slice(0, NEW_ROUND_HERE_CAP) : [];
  const factStats = pintFactStats(pubs, name, boroughSlug);
  const faq = faqItems(factStats, {
    monthYear: formatMonthYear(observedAt),
    year: String(observedAt.getFullYear()),
  });
  const faqLd = faqPageJsonLd(faq);
  const jsonLdGraph = [
    ...boroughJsonLd(name, boroughSlug, pubs),
    ...(faqLd ? [faqLd] : []),
  ];

  return (
    <main id="main" className="boroughPage listingShell">
      <JsonLd data={jsonLdGraph} />
      <SiteNav active="borough" />

      <BoroughScreen
        kicker={name}
        title={`Pubs in ${name}.`}
        titleId="boroughHeading"
        lede={
          pubs.length > 0 ? (
            <>
              {pubs.length} {pubs.length === 1 ? "pub" : "pubs"} in {name}, ranked
              cheapest pint first.
            </>
          ) : undefined
        }
        mapHref={pubs.length > 0 ? boroughBrowseMapUrl(name) : "/map"}
        mapLabel={pubs.length > 0 ? "Open the map here" : "Open the map"}
        photo={boroughPlacePhoto(name) ?? londonPlacePhoto() ?? undefined}
      >
        <BoroughPintPriceCard boroughName={name} ourCheapestPrice={ourCheapestPrice} />
        {pubs.length > 0 && pubs.length < BOROUGH_COVERAGE_FLOOR ? (
          <p className="boroughThinBanner" role="status">
            Only {pubs.length} pubs mapped in {name} so far. Every pin&rsquo;s a real
            pub. We just haven&rsquo;t covered every street yet.
          </p>
        ) : null}

        {/* A section with no rows renders nothing (taste plan, 18 Oct 2026):
            "No current updates here" under a heading was a card of nothing
            above the pubs the reader came for. */}
        {areaNewsRead.status === "ready" && areaNews.length > 0 ? (
          <AreaNewsList
            areaLabel={name}
            entries={areaNews}
            status={areaNewsRead.status}
            headingId="boroughAreaNewsHeading"
          />
        ) : null}

        {pubs.length === 0 ? (
          <EmptyState
            className="boroughEmpty"
            title={`No pubs mapped in ${name} yet.`}
            action={<Link href="/borough">Browse other boroughs</Link>}
          >
            The rest of London is on the map already. This corner just hasn&rsquo;t
            been walked yet.
          </EmptyState>
        ) : (
          // One row per pub, cheapest first: rank, name and the pint it is
          // priced on, then the price at the row's end. The pub opens on the
          // map; its price opens its price history (/ledger), so the history
          // link is the figure it is the history of, said once above the list
          // rather than a "Price history" line repeated under every pub.
          <section className="boroughPubs" aria-labelledby="boroughPubsHeading">
            <h2 id="boroughPubsHeading" className="srOnly">
              Pubs in {name}, ordered by cheapest pint price
            </h2>
            <p className="boroughPubsNote">Tap a price for its history.</p>
            <RowList label={`Pubs in ${name}, cheapest pint first`} className="boroughRows boroughPubRows listingRead">
              {pubs.map((pub, index) => (
                <RowListItem
                  key={pub.id}
                  href={venueMapUrl(pub.id)}
                  lead={<span className="boroughRank">{index + 1}</span>}
                  title={pub.name}
                  meta={pub.cheapestPint ? displayDrinkName(pub.cheapestPint) : undefined}
                  trailing={
                    <Link
                      prefetch={false}
                      href={`/ledger/${pub.id}`}
                      className="boroughLedgerLink"
                      aria-label={`${pub.name}: price history`}
                    >
                      <BoroughPubPrice pub={pub} />
                    </Link>
                  }
                />
              ))}
            </RowList>
          </section>
        )}

        {storyPubs.length > 0 ? (
          <section className="boroughSection" aria-labelledby="boroughStoryHeading">
            <h2 id="boroughStoryHeading" className="listingSectionTitle">
              Story pubs in {name}
            </h2>
            <p className="listingSectionDek">
              {storyPubs.length} {storyPubs.length === 1 ? "pub here has" : "pubs here have"} a heritage
              note or a passed-down story. Each is worth a detour for more than the price.
            </p>
            <ul className="boroughChipList" aria-label={`Story pubs in ${name}`}>
              {storyPubs.slice(0, STORY_CHIP_CAP).map((pub) => (
                <li key={pub.id}>
                  <Link prefetch={false} href={venueMapUrl(pub.id)} className="boroughChip">
                    {pub.name}
                  </Link>
                </li>
              ))}
            </ul>
            {storyPubs.length > STORY_CHIP_CAP ? (
              <p className="boroughChipMore">
                And {storyPubs.length - STORY_CHIP_CAP} more in the list above.
              </p>
            ) : null}
          </section>
        ) : null}

        {touchingCrawls.length > 0 ? (
          <section className="boroughSection" aria-labelledby="boroughCrawlsHeading">
            <h2 id="boroughCrawlsHeading" className="listingSectionTitle">
              Crawls through {name}
            </h2>
            <p className="listingSectionDek">
              Listed routes with at least one stop here. Each opens on the map, first stop to last.
            </p>
            <RowList label={`Crawls through ${name}`} className="boroughRows listingRead">
              {touchingCrawls.map((crawl) => (
                <RowListItem
                  key={crawl.id}
                  href={curatedCrawlMapHref(crawl)}
                  title={crawl.name}
                  meta={plainDashes(crawl.blurb)}
                />
              ))}
            </RowList>
          </section>
        ) : null}

        <BoroughPassportSlice boroughName={name} venueIds={pubs.map((pub) => pub.id)} />

        {heritage ? (
          <section className="boroughSection" aria-labelledby="boroughHeritageHeading">
            <h2 id="boroughHeritageHeading" className="listingSectionTitle">
              Historic pubs in {name}
            </h2>
            <p className="listingSectionDek">
              {heritage.count} notable {heritage.count === 1 ? "pub" : "pubs"} on record
              {heritage.oldest ? (
                <>
                  {". The oldest is "}
                  {heritage.oldest.name}
                  {(heritage.oldest.dateLabel ?? heritage.oldest.era) ? (
                    <> ({heritage.oldest.dateLabel ?? heritage.oldest.era})</>
                  ) : null}
                </>
              ) : null}
              {heritage.listedCount > 0 ? <> &middot; {heritage.listedCount} listed</> : null}.
            </p>
            <RowList label={`Historic pubs in ${name}`} className="boroughRows listingRead">
              {heritage.notable.slice(0, NOTABLE_CAP).map((pub) => {
                const date = pub.dateLabel ?? pub.era;
                const facts = [date, pub.listed ? `Grade ${pub.listed}` : null].filter(Boolean).join(", ");
                return (
                  <RowListItem
                    key={pub.slug}
                    href={`/historic/${pub.slug}` as Route}
                    title={pub.name}
                    meta={facts || undefined}
                  />
                );
              })}
            </RowList>
            <p className="boroughHeritageProvenance">Cited from Wikipedia.</p>
            <p className="boroughHeritageFoot">
              <Link href="/historic" className="listingLink">See all historic pubs</Link>
            </p>
          </section>
        ) : null}

        <FactBlock
          stats={factStats}
          monthYear={formatMonthYear(observedAt)}
          observedDate={formatObservedDate(observedAt)}
          headingId="boroughFactHeading"
          title={`Pint prices in ${name}, by the numbers`}
        />

        <FaqBlock
          items={faq}
          headingId="boroughFaqHeading"
          title={`Pint prices in ${name}: questions`}
        />

        {/* Internal cross-links (Wave S3.5): let crawlers walk borough → map →
            Pint Index → historic via plain hrefs. Individual /ledger permalinks
            already sit in the pubs table above. */}
        <nav className="factLinks" aria-labelledby="boroughLinksHeading">
          <p className="factLinksTitle" id="boroughLinksHeading">
            Explore more
          </p>
          <ul className="factLinksList">
            <li>
              <Link prefetch={false} href={boroughBrowseMapUrl(name)}>{name} on the map</Link>
            </li>
            {neighbourhoodLinks.map((link) => (
              <li key={link.href}>
                <Link prefetch={false} href={link.href}>{link.label}</Link>
              </li>
            ))}
            <li>
              <Link href="/pint-index">London Pint Index</Link>
            </li>
            {heritage ? (
              <li>
                <Link href="/historic">Historic pubs</Link>
              </li>
            ) : null}
            <li>
              <Link href="/borough">All boroughs</Link>
            </li>
          </ul>
        </nav>
      </BoroughScreen>
    </main>
  );
}
