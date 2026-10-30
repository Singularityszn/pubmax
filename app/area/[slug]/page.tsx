import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import PricedLandingRows, {
  PricedLandingPublisher,
  formatPricedLandingCollectedDate,
} from "@/components/drinks/PricedLandingRows";
import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import { areaLandingRoute } from "@/lib/areaLanding";
import { areaLandingJsonLd, loadAreaLanding } from "@/lib/areaLanding.server";
import { loadDrinkBrandAreaLandings } from "@/lib/drinkBrandAreaLanding.server";
import { mapAreaHref } from "@/lib/mapAreaArrival";
import { getNightAreasForCity, type NightArea } from "@/lib/nightAreas";
import {
  formatPricedLandingPublisherStatus,
  pricedLandingCountLabel,
} from "@/lib/pricedLanding";
import { slugifyVenueName } from "@/lib/venuePermalinkSlug";
import { formatPrice } from "@/lib/venues";

import "@/components/drinks/drinkBrandDirectory.css";

// /area/{slug}: the cheapest listed pints in one London Night Area (SEO audit
// #2126, finding 17). An area with PRICED_LANDING_PUBLICATION_FLOORS.area
// priced pubs has a page (lib/areaLanding.ts). Every other name keeps the old
// answer: a catalogue slug, name or alias that matches exactly one area
// redirects, to that area's page when it has one and to its map area when it
// does not. Unknown or ambiguous names are a 404.
//
// The page renders per request with its nonce. It is not on the CDN document
// lists in proxy.ts; joining them is a separate captain decision.

type PageProps = { params: Promise<{ slug: string }> };

function matchingArea(slug: string): NightArea | null {
  const matches = getNightAreasForCity("london").filter((area) =>
    area.slug === slug || [area.name, ...area.aliases].some((name) => slugifyVenueName(name) === slug),
  );
  return matches.length === 1 ? matches[0]! : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const landing = await loadAreaLanding(slug);
  if (!landing) return { title: "Area", robots: { index: false, follow: false } };

  const firstRow = landing.rows[0];
  const title = `Cheapest pints in ${landing.areaName}`;
  const description = `${landing.totalPricedVenues} ${landing.areaName} pubs with listed pint prices, from ${formatPrice(firstRow.priceGbp)}. ${formatPricedLandingPublisherStatus(firstRow.publisher)}.`;
  const canonical = areaLandingRoute(landing.areaSlug);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: "website", url: canonical },
    twitter: { card: "summary", title, description },
  };
}

export default async function AreaPage({ params }: PageProps) {
  const { slug } = await params;
  const landing = await loadAreaLanding(slug);
  if (!landing) {
    const area = matchingArea(slug);
    if (!area) notFound();
    const canonical = await loadAreaLanding(area.slug);
    permanentRedirect(canonical ? areaLandingRoute(area.slug) : mapAreaHref(area));
  }

  const area = matchingArea(landing.areaSlug)!;
  const firstRow = landing.rows[0];
  const brandPages = (await loadDrinkBrandAreaLandings()).filter(
    (pair) => pair.areaSlug === landing.areaSlug,
  );

  return (
    <main id="main" className="drinkBrandAreaLanding areaLanding">
      <JsonLd data={areaLandingJsonLd(landing)} />
      <SiteNav />
      <div className="drinkBrandDirectory">
        <header className="drinkBrandDirectory__head">
          <p className="drinkBrandDirectory__eyebrow">
            <Link prefetch={false} href="/map">London map</Link> <span aria-hidden="true">·</span>{" "}
            {landing.areaName}
          </p>
          <h1>Cheapest pints in {landing.areaName}</h1>
          <p className="drinkBrandDirectory__from">
            <strong>From {formatPrice(firstRow.priceGbp)}</strong>
            <PricedLandingPublisher className="drinkBrandDirectory__fromPublisher" row={firstRow} variant="hero" />
          </p>
          <p className="drinkBrandDirectory__summary">
            {landing.totalPricedVenues} pubs with listed pint prices.
            {landing.collectedAt
              ? ` Collected ${formatPricedLandingCollectedDate(landing.collectedAt)}.`
              : null}
          </p>
          <div className="drinkBrandDirectory__actions">
            <Link className="drinkBrandDirectory__primary" prefetch={false} href={mapAreaHref(area)}>
              Open {landing.areaName} on the map
            </Link>
          </div>
        </header>

        <section className="drinkBrandDirectory__prices" aria-labelledby="area-price-heading">
          <div className="drinkBrandDirectory__sectionHead">
            <h2 id="area-price-heading">The pubs</h2>
            <span className="drinkBrandDirectory__sectionCount">
              {pricedLandingCountLabel(landing.totalPricedVenues, landing.rows.length)}
            </span>
          </div>
          <PricedLandingRows rows={landing.rows} />
        </section>

        {landing.transportAnchors.length > 0 ? (
          <section className="drinkBrandDirectory__prices" aria-labelledby="area-stations-heading">
            <div className="drinkBrandDirectory__sectionHead">
              <h2 id="area-stations-heading">Stations</h2>
            </div>
            <p className="drinkBrandDirectory__summary">
              The area is planned around {landing.transportAnchors.join(", ")}.
            </p>
          </section>
        ) : null}

        {brandPages.length > 0 ? (
          <section className="drinkBrandDirectory__prices" aria-labelledby="area-brands-heading">
            <div className="drinkBrandDirectory__sectionHead">
              <h2 id="area-brands-heading">By beer</h2>
            </div>
            <ul className="drinkBrandDirectory__summary">
              {brandPages.map((pair) => (
                <li key={pair.brandSlug}>
                  <Link
                    href={`/area/${encodeURIComponent(pair.areaSlug)}/drink/${encodeURIComponent(pair.brandSlug)}`}
                  >
                    Cheapest {pair.brandLabel} in {pair.areaName}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
