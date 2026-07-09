import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getVenueIndex, venueMapUrl } from "@/lib/venueIndex";
import { groupVenuePrices, formatPrice, type Venue, type VenuePrice } from "@/lib/venues";
import { boroughFromSlug, pubsInBorough, slugifyBorough } from "@/lib/boroughs";
import { curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/EmptyState";

import "./borough.css";

// Borough discovery / "night-out chapter" page: /borough/[slug]. A SERVER
// component (cc_plan2 §14/§25, story 28) — it reads the bundled dataset via
// getVenueIndex's underlying loader (venueIndex is server-only, which is fine
// here), groups it, resolves the borough from the slug, and renders a
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

// Reproduce a curated crawl on the map — same share-URL shape the crawls page
// uses (mode=build&pubs=id1,id2).
function curatedCrawlHref(crawl: CuratedCrawl): string {
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", crawl.venueIds.join(","));
  return `/map?${params.toString()}`;
}

// Cap the crawl deep-link to a shareable number of stops — a large borough's
// full pub list would make an unwieldy URL.
const MAP_LINK_STOP_CAP = 12;

/** Borough floor for Outer London honesty banner (Wave H4 / PRD P1). */
const BOROUGH_COVERAGE_FLOOR = 15;

// Browse the borough on the clean map via search (`?q=`), so outer areas like
// Barnet open without resurrecting a hand-built crawl into the planner.
function boroughBrowseMapUrl(name: string): string {
  const params = new URLSearchParams();
  params.set("q", name);
  return `/map?${params.toString()}`;
}

// Optional crawl deep-link: pre-build the same share-URL shape a hand-built
// crawl uses (mode=build&pubs=id1,id2). Honest: "here's where they are", not
// a routed transit itinerary.
function boroughMapUrl(pubs: Venue[]): string {
  if (pubs.length === 0) return "/map";
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", pubs.slice(0, MAP_LINK_STOP_CAP).map((pub) => pub.id).join(","));
  return `/map?${params.toString()}`;
}

// Load the grouped venue set from disk. We reuse the same dataset getVenueIndex
// reads (via its build path) but need full Venue[] here, not the id→ref map, so
// we group the rows ourselves. Never throws: a read/parse failure yields [] so
// the page degrades to a friendly empty state rather than 500-ing. getVenueIndex
// is awaited first purely to keep the server-only import wired and the dataset
// warm in the same memoized path the rest of the app uses.
async function loadVenues() {
  try {
    await getVenueIndex();
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const file = path.join(
      process.cwd(),
      "public",
      "data",
      "pint_prices_app_dataset.json",
    );
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
    return groupVenuePrices(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const venues = await loadVenues();
  const name = boroughFromSlug(slug, venues);

  if (!name) {
    return {
      title: "Borough — PUBMAXXING",
      robots: { index: false, follow: false },
    };
  }

  const title = `The cheapest pints and best pubs in ${name} — PUBMAXXING`;
  const pubs = pubsInBorough(venues, slug);
  const cheapest = pubs.find((pub) => typeof pub.cheapestPrice === "number")?.cheapestPrice;
  const description =
    typeof cheapest === "number"
      ? `${pubs.length} pubs in ${name}, ranked cheapest-first — pints from ${formatPrice(
          cheapest,
        )}. Plan a crawl through the area on PUBMAXXING.`
      : `${pubs.length} pubs in ${name} on the map. Plan a crawl through the area on PUBMAXXING.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function BoroughPage({ params }: PageProps) {
  const { slug } = await params;
  const venues = await loadVenues();
  const name = boroughFromSlug(slug, venues);
  if (!name) notFound();

  const pubs = pubsInBorough(venues, slug);
  const storyPubs = pubs.filter((pub) => pub.hasStory);
  const touchingCrawls = crawlsTouchingBorough(curatedCrawls, venues, slug);

  return (
    <main className="boroughPage">
      <SiteNav active="borough" />

      <header className="boroughHead">
        <p className="boroughEyebrow">
          <Link href="/borough">Boroughs</Link> · London
        </p>
        <h1 className="boroughTitle">Pubs in {name}</h1>
        <p className="boroughDek">
          {pubs.length === 0 ? (
            <>No pubs mapped in {name} just yet — the rest of London is on the map.</>
          ) : (
            <>
              {pubs.length} {pubs.length === 1 ? "pub" : "pubs"} in {name}, ranked
              cheapest pint first. This is how locals actually talk about a night
              out — by the area — so here&rsquo;s the corner of the map that
              belongs to {name}.
            </>
          )}
        </p>
        {pubs.length > 0 && pubs.length < BOROUGH_COVERAGE_FLOOR ? (
          <p className="boroughThinBanner" role="status">
            Thin coverage in {name} for now ({pubs.length} of {BOROUGH_COVERAGE_FLOOR}+
            we&rsquo;re aiming for). Every pin is a real pub — we won&rsquo;t invent
            denser streets.
          </p>
        ) : null}
        <div className="boroughMapLinks">
          <Link className="boroughCrawlLink" href={boroughBrowseMapUrl(name)}>
            {pubs.length > 0 ? `View ${name} on the map →` : "Open the map →"}
          </Link>
          {pubs.length > 0 ? (
            <Link className="boroughCrawlLink boroughCrawlLinkSecondary" href={boroughMapUrl(pubs)}>
              Start a crawl from cheapest pubs →
            </Link>
          ) : null}
        </div>
      </header>

      {pubs.length === 0 ? (
        <EmptyState
          eyebrow="Nothing pinned here yet"
          title={`No pubs mapped in ${name} yet.`}
          body="The rest of London is on the map already — this corner just hasn't been walked yet."
          action={<Link href="/borough">Browse other boroughs</Link>}
        />
      ) : (
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
              <th scope="col" className="boroughPriceHead">
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
                  <Link href={venueMapUrl(pub.id)} className="boroughPub">
                    {pub.name}
                  </Link>
                  {pub.cheapestPint ? (
                    <span className="boroughPint">{pub.cheapestPint}</span>
                  ) : null}
                  <Link href={`/ledger/${pub.id}`} className="boroughLedgerLink">
                    The Ledger →
                  </Link>
                </td>
                <td className="boroughPriceCell">
                  {typeof pub.cheapestPrice === "number" ? (
                    <span className="priceStamp">{formatPrice(pub.cheapestPrice)}</span>
                  ) : (
                    <span className="boroughNoPrice">No price</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {storyPubs.length > 0 ? (
        <section className="boroughSection" aria-labelledby="boroughStoryHeading">
          <h2 id="boroughStoryHeading" className="boroughSectionTitle">
            Story pubs in {name}
          </h2>
          <p className="boroughSectionDek">
            {storyPubs.length} {storyPubs.length === 1 ? "pub" : "pubs"} here carry a heritage
            note or a passed-down story — the ones worth a detour, not just a cheap pint.
          </p>
          <ul className="boroughChipList" aria-label={`Story pubs in ${name}`}>
            {storyPubs.map((pub) => (
              <li key={pub.id}>
                <Link href={venueMapUrl(pub.id)} className="boroughChip">
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
            A curated route with at least one stop here — plan the whole walk, not just this
            borough&rsquo;s corner of it.
          </p>
          <ul className="boroughCrawlList" aria-label={`Curated crawls through ${name}`}>
            {touchingCrawls.map((crawl) => (
              <li key={crawl.id} className="boroughCrawlCard">
                <div>
                  <strong>{crawl.name}</strong>
                  <p>{crawl.blurb}</p>
                </div>
                <Link
                  href={curatedCrawlHref(crawl)}
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

      <p className="boroughFootnote">
        Every pint has a story. <Link href="/borough">See every borough →</Link>
      </p>
    </main>
  );
}
