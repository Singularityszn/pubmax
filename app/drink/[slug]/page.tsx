import type { Metadata } from "next";
import { notFound } from "next/navigation";

import DrinkBrandLandingContent from "@/components/drinks/DrinkBrandLandingContent";
import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import {
  drinkBrandLandingJsonLd,
  loadDrinkBrandLanding,
  loadDrinkBrandLandings,
} from "@/lib/drinkBrandLanding.server";
import { loadDrinkBrandAreaLandingsForBrand } from "@/lib/drinkBrandAreaLanding.server";
import { loadMapSelectableVenueIds } from "@/lib/mapEagerVenueIndex.server";
import {
  formatPricedLandingPublisherStatus,
  pricedLandingBrandAreaLinks,
} from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

import "@/components/drinks/drinkBrandDirectory.css";

type PageProps = { params: Promise<{ slug: string }> };

// THIS DOCUMENT IS PRERENDERED (task vercel-f2-seo-cdn, recorded in proxy.ts
// beside CDN_CACHED_DOCUMENT_ROUTES): it drops the per-request CSP nonce so the
// Vercel CDN can hold it. It renders only bundled data and reads no cookie, no
// header and no search param. `__tests__/cdnCachedDocuments.test.ts` holds
// both rules.
export const dynamic = "force-static";
// The data changes only on a deploy, so an hour is the same quiet ceiling
// `/map` takes: it bounds how long a stale copy can outlive a change nobody
// redeployed for.
export const revalidate = 3600;
// Only a slug the loader publishes renders at all.
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return (await loadDrinkBrandLandings()).map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const landing = await loadDrinkBrandLanding(slug);

  if (!landing) {
    return {
      title: "Drink",
      robots: { index: false, follow: false },
    };
  }

  const title = `Cheapest ${landing.brandLabel} pints in London`;
  const firstRow = landing.rows[0];
  const publisherStatus = formatPricedLandingPublisherStatus(
    firstRow.publisher,
  );
  const description = `${landing.totalPricedVenues} London pubs with listed ${landing.brandLabel} pints from ${formatPrice(firstRow.priceGbp)}. ${publisherStatus}.`;
  const canonical = `/drink/${encodeURIComponent(landing.slug)}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function DrinkBrandLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const landing = await loadDrinkBrandLanding(slug);
  if (!landing) notFound();

  const [mapSelectableVenueIds, areaLandings] = await Promise.all([
    loadMapSelectableVenueIds(),
    loadDrinkBrandAreaLandingsForBrand(landing.slug),
  ]);

  return (
    <main id="main" className="drinkBrandLanding">
      <JsonLd data={drinkBrandLandingJsonLd(landing)} />
      <SiteNav />
      <DrinkBrandLandingContent
        landing={landing}
        mapSelectableVenueIds={mapSelectableVenueIds}
        areaPages={pricedLandingBrandAreaLinks(landing.slug, areaLandings)}
      />
    </main>
  );
}
