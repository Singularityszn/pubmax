import type { Metadata } from "next";
import { notFound } from "next/navigation";

import JsonLd from "@/components/seo/JsonLd";
import SiteNav from "@/components/nav/SiteNav";
import {
  getHistoricPubBySlug,
  loadHistoricPubs,
  type HistoricPub,
} from "@/lib/historic";
import { BRAND_NAME } from "@/lib/brandNaming";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import { venueListedPint, type VenueListedPint } from "@/lib/venueListedPint";
import HistoricPubDetail from "./HistoricPubDetail";

import "@/components/listing/listing.css";
import "./historic-detail.css";

// Per-pub heritage DETAIL page: /historic/[slug]. The canonical, shareable,
// SEO-first surface for one notable London pub — the FULL cited heritage story.
//
// Provenance-honest by construction: every fact is rendered verbatim with its
// source named and a citation link derived strictly from the record's own
// sourceRef (HistoricPubDetail.tsx). Nothing is invented; the metadata
// description is the pub's own hook, not a fabricated claim. A parallel agent
// owns the colocated opengraph-image, so this file only writes honest metadata
// — it never references the OG asset.
//
// Next 15/16 dynamic route params are async: `params` is a Promise we await.
// generateStaticParams pre-renders one static page per slug for clean SEO.

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

// Trim + collapse the hook into a clean meta description, capped for SEO. Never
// invents copy — an empty hook falls back to a neutral, honest sentence.
function metaDescription(pub: HistoricPub): string {
  const hook = pub.hook?.replace(/\s+/g, " ").trim() ?? "";
  const base =
    hook || `${pub.name}, a notable London pub. Cited from Wikipedia and Wikidata.`;
  return base.length > 155 ? `${base.slice(0, 154).trimEnd()}…` : base;
}

// Pre-render every notable pub as its own static page (SEO surface).
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const pubs = await loadHistoricPubs();
  return pubs.map((pub) => ({ slug: pub.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const pub = getHistoricPubBySlug(slug, await loadHistoricPubs());

  if (!pub) {
    return {
      title: "Historic pub",
      robots: { index: false, follow: false },
    };
  }

  // The layout's template adds the brand to the document title. The share
  // card is not templated, so it keeps the branded form.
  const title = `${pub.name}. Historic London pub`;
  const cardTitle = `${title} | ${BRAND_NAME}`;
  const description = metaDescription(pub);
  const canonical = `/historic/${pub.slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title: cardTitle,
      description,
      url: canonical,
      type: "article",
    },
    twitter: { card: "summary_large_image", title: cardTitle, description },
  };
}

const SITE_URL = "https://pubmaxxing.com";

// A citation can describe a pub without identifying it. Only a single
// Wikipedia/Wikidata identity reference is unambiguous enough for sameAs.
// Multiple references stay visible as citations until the record is reconciled.
function historicPubJsonLd(pub: HistoricPub) {
  const identityRefs = Array.from(
    new Set(
      pub.facts
        .filter((fact) => fact.source === "wikipedia" || fact.source === "wikidata")
        .map((fact) => fact.sourceRef)
        .filter((ref): ref is string =>
          typeof ref === "string" &&
          /^https:\/\/(?:en\.wikipedia\.org\/wiki\/[^?#]+|www\.wikidata\.org\/wiki\/Q[1-9]\d*)$/.test(ref),
        ),
    ),
  );
  const page = {
    "@context": "https://schema.org",
    name: pub.name,
    url: `${SITE_URL}/historic/${pub.slug}`,
  };
  // Unreconciled references can combine different pubs. Describe this page
  // without asserting that their descriptions and locations identify one place.
  if (identityRefs.length > 1) return { ...page, "@type": "WebPage" };

  return {
    ...page,
    "@type": "LandmarksOrHistoricalBuildings",
    ...(pub.hook ? { description: pub.hook } : {}),
    ...(pub.borough
      ? {
          address: {
            "@type": "PostalAddress",
            addressLocality: pub.borough,
            addressRegion: "London",
            addressCountry: "GB",
          },
        }
      : {}),
    ...(typeof pub.lat === "number" && typeof pub.lng === "number"
      ? { geo: { "@type": "GeoCoordinates", latitude: pub.lat, longitude: pub.lng } }
      : {}),
    ...(identityRefs.length === 1 ? { sameAs: identityRefs } : {}),
  };
}

// The pint the app lists for this pub, read from the same priced index the map
// pin and Tonight read, so the figure here is the figure everywhere. Null when
// the pub resolves to no venue or the venue holds no listed price: the page
// then says so and offers the way to log one.
async function historicListedPint(pub: HistoricPub): Promise<VenueListedPint | null> {
  if (!pub.venueId) return null;
  const venue = (await getPricedVenues()).find((row) => row.id === pub.venueId);
  return venue ? venueListedPint(venue) : null;
}

export default async function HistoricDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const pub = getHistoricPubBySlug(slug, await loadHistoricPubs());
  if (!pub) notFound();

  return (
    <main id="main" className="hdPage listingShell">
      <JsonLd data={historicPubJsonLd(pub)} />
      <SiteNav active="historic" />

      <HistoricPubDetail pub={pub} listedPint={await historicListedPint(pub)} />
    </main>
  );
}
