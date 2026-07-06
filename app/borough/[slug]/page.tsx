import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getVenueIndex, venueMapUrl } from "@/lib/venueIndex";
import { groupVenuePrices, formatPrice, type VenuePrice } from "@/lib/venues";
import { boroughFromSlug, pubsInBorough } from "@/lib/boroughs";

import "./borough.css";

// Borough discovery page: /borough/[slug]. A SERVER component (cc_plan2
// §14/§25) — it reads the bundled dataset via getVenueIndex's underlying loader
// (venueIndex is server-only, which is fine here), groups it, resolves the
// borough from the slug, and renders a shareable "pubs in Camden" page: a dek,
// a cheapest-first list of that borough's pubs (each linking onto the map) with
// a price stamp, and a "plan a crawl here" link. generateMetadata gives it a
// share-worthy title/description. An unknown slug resolves to notFound() — the
// page never crashes on a borough that doesn't exist.
//
// Next 16 dynamic route params are async — `params` is a Promise we await.

type PageProps = { params: Promise<{ slug: string }> };

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

  return (
    <div className="boroughPage">
      <nav className="siteNav" aria-label="Site navigation">
        <Link href="/">Home</Link>
        <Link href="/map">Map</Link>
        <Link href="/discover">Discover</Link>
        <Link href="/borough" aria-current="page">
          Boroughs
        </Link>
        <Link href="/crawls">Crawls</Link>
      </nav>

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
        <Link className="boroughCrawlLink" href="/map">
          Plan a crawl here →
        </Link>
      </header>

      {pubs.length === 0 ? (
        <p className="boroughEmpty" role="status">
          We don&rsquo;t have any pubs pinned in {name} yet.{" "}
          <Link href="/borough">Browse other boroughs</Link> or{" "}
          <Link href="/map">open the map</Link>.
        </p>
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

      <p className="boroughFootnote">
        Every pint has a story. <Link href="/borough">See every borough →</Link>
      </p>
    </div>
  );
}
