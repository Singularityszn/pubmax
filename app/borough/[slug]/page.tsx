import type { Route } from "next";
import type { Metadata } from "next";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { headers } from "next/headers";
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
import { landingPhotoFor } from "@/lib/landingImagery";
import { loadBoroughHeritage, NOTABLE_CAP } from "@/lib/boroughHeritage";
import { curatedCrawlMapHref, curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/ui/empty-state";
import { ProseDisclosure } from "@/components/Disclosure";
import BoroughScreen from "../BoroughScreen";
import BoroughPassportSlice from "@/components/borough/BoroughPassportSlice";
import BoroughPintPriceCard from "@/components/borough/BoroughPintPriceCard";
import AreaNewsList from "@/components/areanews/AreaNewsList";
import { entriesForBorough, freshAreaNews, NEW_ROUND_HERE_CAP } from "@/lib/areaNews";
import { loadAreaNews } from "@/lib/areaNews.server";

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

// Cap the crawl deep-link to a shareable number of stops — a large borough's
// full pub list would make an unwieldy URL.
const MAP_LINK_STOP_CAP = 12;

/** Borough floor for Outer London honesty banner (Wave H4 / PRD P1). */
const BOROUGH_COVERAGE_FLOOR = 15;

// Browse the borough on the clean map via search (`?q=`), so outer areas like
// Barnet open without resurrecting a hand-built crawl into the planner.
function boroughBrowseMapUrl(name: string): Route {
  const params = new URLSearchParams();
  params.set("q", name);
  return `/map?${params.toString()}`;
}

// Optional crawl deep-link: pre-build the same share-URL shape a hand-built
// crawl uses (mode=build&pubs=id1,id2). Honest: "here's where they are", not
// a routed transit itinerary.
function boroughMapUrl(pubs: Venue[]): Route {
  if (pubs.length === 0) return "/map";
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", pubs.slice(0, MAP_LINK_STOP_CAP).map((pub) => pub.id).join(","));
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
      title: "Borough · PUBMAXXING",
      robots: { index: false, follow: false },
    };
  }

  const title = `The cheapest pints and best pubs in ${name} · PUBMAXXING`;
  const pubs = pubsInBorough(venues, slug);
  const cheapest = pubs.find((pub) => typeof pub.cheapestPrice === "number")?.cheapestPrice;
  const description =
    typeof cheapest === "number"
      ? `${pubs.length} pubs in ${name}, ranked cheapest-first. Pints from ${formatPrice(
          cheapest,
        )}. Plan a crawl through the area on PUBMAXXING.`
      : `${pubs.length} pubs in ${name} on the map. Plan a crawl through the area on PUBMAXXING.`;

  return {
    title,
    description,
    alternates: { canonical: `/borough/${slugifyBorough(name)}` },
    // opengraph-image.tsx sits beside this route, so Next auto-attaches the
    // dynamic borough card to both OG and Twitter. summary_large_image makes X
    // render it as the full 1200×630 card rather than a thumbnail.
    openGraph: { title, description, type: "website", url: `/borough/${slugifyBorough(name)}` },
    twitter: { card: "summary_large_image", title, description },
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
  if (lane === null) return <span className="boroughNoPrice">No price</span>;
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


  // Per-request CSP nonce (proxy.ts) for the JSON-LD block below.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <main id="main" className="boroughPage">
      <JsonLd data={jsonLdGraph} nonce={nonce} />
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
        photo={landingPhotoFor({ boroughSlug: slugifyBorough(name) })}
      >
        <BoroughPintPriceCard boroughName={name} ourCheapestPrice={ourCheapestPrice} />
        {pubs.length > 0 && pubs.length < BOROUGH_COVERAGE_FLOOR ? (
          <p className="boroughThinBanner" role="status">
            Only {pubs.length} pubs mapped in {name} so far. Every pin&rsquo;s a real
            pub. We just haven&rsquo;t covered every street yet.
          </p>
        ) : null}
        {pubs.length > 0 ? (
          <div className="boroughMapLinks">
            <Link prefetch={false} className="boroughCrawlLink boroughCrawlLinkSecondary" href={boroughMapUrl(pubs)}>
              Start a crawl from cheapest pubs →
            </Link>
          </div>
        ) : null}

        <AreaNewsList
          areaLabel={name}
          entries={areaNews}
          status={areaNewsRead.status}
          headingId="boroughAreaNewsHeading"
        />

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
          // A price table is wide content, so it scrolls inside its own box
          // rather than making the page scroll sideways: at 320 the pub column
          // alone put the document 25px past the viewport.
          <div className="boroughTableScroll">
            <table className="boroughTable">
              <caption className="srOnly">
                Pubs in {name}, ordered by cheapest pint price
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="boroughRankHead">
                    #
                  </th>
                  <th scope="col" className="boroughNameHead">
                    Pub
                  </th>
                  <th scope="col" className="boroughPriceHead createFabLane">
                    Cheapest pint
                  </th>
                </tr>
              </thead>
              <tbody>
                {pubs.map((pub, index) => (
                  <tr key={pub.id}>
                    <th scope="row" className="boroughRank">
                      <span className="boroughRankNum">{index + 1}</span>
                    </th>
                    <td className="boroughName">
                      <Link prefetch={false} href={venueMapUrl(pub.id)} className="boroughPub">
                        {pub.name}
                      </Link>
                      {pub.cheapestPint ? (
                        <span className="boroughPint">{pub.cheapestPint}</span>
                      ) : null}
                      <Link href={`/ledger/${pub.id}`} className="boroughLedgerLink">
                        Price history →
                      </Link>
                    </td>
                    <td className="boroughPriceCell createFabLane">
                      <BoroughPubPrice pub={pub} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {storyPubs.length > 0 ? (
          <section className="boroughSection" aria-labelledby="boroughStoryHeading">
            <h2 id="boroughStoryHeading" className="boroughSectionTitle">
              Story pubs in {name}
            </h2>
            <p className="boroughSectionDek">
              {storyPubs.length} {storyPubs.length === 1 ? "pub" : "pubs"} here carry a heritage
              note or a passed-down story. Each offers a reason to detour beyond price.
            </p>
            <ul className="boroughChipList" aria-label={`Story pubs in ${name}`}>
              {storyPubs.map((pub) => (
                <li key={pub.id}>
                  <Link prefetch={false} href={venueMapUrl(pub.id)} className="boroughChip">
                    {pub.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {touchingCrawls.length > 0 ? (
          <section className="boroughSection" aria-labelledby="boroughCrawlsHeading">
            <h2 id="boroughCrawlsHeading" className="boroughSectionTitle">
              Crawls through {name}
            </h2>
            <p className="boroughSectionDek">
              A listed route with at least one stop here. Plan it from its first stop to its last.
            </p>
            <ul className="boroughCrawlList" aria-label={`Crawls through ${name}`}>
              {touchingCrawls.map((crawl) => (
                <li key={crawl.id} className="boroughCrawlCard">
                  <div>
                    <strong>{crawl.name}</strong>
                    <p>{crawl.blurb}</p>
                  </div>
                  <Link prefetch={false}
                    href={curatedCrawlMapHref(crawl)}
                    className="boroughCrawlPlanLink"
                    aria-label={`Plan the ${crawl.name} crawl on the map`}
                  >
                    Plan this crawl →
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <BoroughPassportSlice boroughName={name} venueIds={pubs.map((pub) => pub.id)} />

        {heritage ? (
          <section className="boroughSection" aria-labelledby="boroughHeritageHeading">
            <h2 id="boroughHeritageHeading" className="boroughSectionTitle">
              Historic pubs in {name}
            </h2>
            <p className="boroughSectionDek">
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
            <p className="boroughHeritageProvenance">Cited from Wikipedia.</p>
            <ul className="boroughHeritageList" aria-label={`Historic pubs in ${name}`}>
              {heritage.notable.slice(0, NOTABLE_CAP).map((pub) => (
                <li key={pub.slug} className="boroughHeritageCard">
                  {pub.dateLabel || pub.era || pub.listed ? (
                    <div className="boroughHeritageMeta">
                      {(pub.dateLabel ?? pub.era) ? (
                        <span className="boroughHeritageEra">
                          {pub.dateLabel ?? pub.era}
                        </span>
                      ) : null}
                      {pub.listed ? (
                        <span className="boroughHeritageGrade">Grade {pub.listed}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <h3 className="boroughHeritageName">{pub.name}</h3>
                  {pub.hook ? (
                    <div className="boroughHeritageHook">
                      <ProseDisclosure text={pub.hook} />
                    </div>
                  ) : null}
                  {pub.venueId ? (
                    <Link prefetch={false}
                      className="boroughHeritageMapLink"
                      href={`/map?sel=${pub.venueId}`}
                      aria-label={`See ${pub.name} on the map`}
                    >
                      See on map &rarr;
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="boroughHeritageFoot">
              <Link href="/historic">See all historic pubs &rarr;</Link>
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

        <p className="boroughFootnote">
          Pubs, prices and stories by area. <Link href="/borough">See every borough →</Link>
        </p>
      </BoroughScreen>
    </main>
  );
}
