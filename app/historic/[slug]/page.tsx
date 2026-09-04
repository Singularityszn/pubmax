import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import JsonLd from "@/components/seo/JsonLd";
import SiteNav from "@/components/nav/SiteNav";
import {
  getHistoricPubBySlug,
  loadHistoricPubs,
  type HistoricPub,
} from "@/lib/historic";
import HistoricPubDetail from "./HistoricPubDetail";

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
      title: "Historic pub. PUBMAXXING",
      robots: { index: false, follow: false },
    };
  }

  const title = `${pub.name}. Historic London pub | PUBMAXXING`;
  const description = metaDescription(pub);
  const canonical = `/historic/${pub.slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "article",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

const SITE_URL = "https://pubmaxxing.com";

// LandmarksOrHistoricalBuildings structured data for a cited historic pub
// (Wave S1.3). Every field is lifted verbatim from the record — name, the
// borough it sits in, its coordinates, its own hook — and `sameAs` carries the
// Wikipedia/Wikidata citation URLs from the pub's cited facts, so an AI engine
// can follow provenance straight to the source. Nothing invented: a field only
// appears when the record actually carries it.
function historicPubJsonLd(pub: HistoricPub) {
  const sameAs = Array.from(
    new Set(
      pub.facts
        .map((fact) => fact.sourceRef)
        .filter((ref): ref is string => typeof ref === "string" && /^https?:\/\//.test(ref)),
    ),
  );
  return {
    "@context": "https://schema.org",
    "@type": "LandmarksOrHistoricalBuildings",
    name: pub.name,
    url: `${SITE_URL}/historic/${pub.slug}`,
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
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export default async function HistoricDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const pub = getHistoricPubBySlug(slug, await loadHistoricPubs());
  if (!pub) notFound();

  // Per-request CSP nonce (proxy.ts) for the JSON-LD block.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <main id="main" className="hdPage">
      <JsonLd data={historicPubJsonLd(pub)} nonce={nonce} />
      <SiteNav active="historic" />

      <HistoricPubDetail pub={pub} />
    </main>
  );
}
