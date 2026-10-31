import type { Route } from "next";
import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import LandmarkHeroPhoto from "@/components/LandmarkHeroPhoto";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { landmarkById, nearestStoryPubs } from "@/lib/landmarks";
import {
  STORY_PUBS_DISTANCE_CAVEAT,
  STORY_PUBS_NEARBY_HEADING,
} from "@/lib/landmarkVenueProximity";
import { formatLogNearbyDistance } from "@/lib/mapLogIntent";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

import "./landmark.css";

type PageProps = { params: Promise<{ id: string }> };

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

let cachedVenues: Venue[] | null = null;

async function getVenues(): Promise<Venue[]> {
  if (cachedVenues) return cachedVenues;
  try {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const file = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
    // Only cache a successful read. An I/O / parse failure must not permanently
    // hide nearby pubs for the lifetime of this lambda/process.
    cachedVenues = groupVenuePrices(Array.isArray(rows) ? rows : []);
    return cachedVenues;
  } catch {
    return [];
  }
}

function startCrawlHref(pubIds: string[]): Route {
  const params = new URLSearchParams();
  params.set("mode", "build");
  params.set("pubs", pubIds.join(","));
  return `/map?${params.toString()}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const landmark = landmarkById(id);
  if (!landmark) {
    return { title: "Landmark chapter", robots: { index: false, follow: false } };
  }
  // The layout's template adds the brand to the document title; the share
  // card is not templated, so it carries the brand itself.
  const title = `${landmark.name}: London story chapter`;
  const cardTitle = appPageTitle(title);
  const description = landmark.history.slice(0, 155);
  const canonical = `/landmark/${landmark.id}`;
  return {
    title,
    description,
    alternates: { canonical },
    // App Router shallow-merges metadata: a child openGraph REPLACES the
    // layout's object wholesale, so the shared siteName + /og.png card must be
    // restated here or they'd be dropped on landmark shares. (This route has no
    // file-convention OG image of its own.)
    openGraph: {
      title: cardTitle,
      description,
      type: "article",
      url: canonical,
      siteName: metadataSiteName(),
      images: ["/og.png"],
    },
    twitter: { card: "summary", title: cardTitle, description },
  };
}

export default async function LandmarkChapterPage({ params }: PageProps) {
  const { id } = await params;
  const landmark = landmarkById(id);
  if (!landmark) notFound();

  const venues = await getVenues();
  const nearby = nearestStoryPubs(landmark, venues, 5);
  const crawlIds = nearby.map((row) => row.venue.id).slice(0, 3);
  const mapHref: Route = `/map?landmark=${encodeURIComponent(landmark.id)}`;

  return (
    <main id="main" className="landmarkChapterPage">
      <SiteNav active="social" />
      <header className="landmarkChapterHead">
        {/* Deep-link to THIS landmark on the map (?landmark= is the existing
            shareable-URL param PubMap seeds from) — a bare /map dead-ends with
            nothing selected. */}
        <a className="landmarkChapterEyebrow" href={mapHref}>
          PUBMAXX · London stories
        </a>
        <h1 className="landmarkChapterTitle">{landmark.name}</h1>
      </header>

      {landmark.image ? (
        <LandmarkHeroPhoto
          key={landmark.id}
          image={landmark.image}
          name={landmark.name}
          className="landmarkChapterPhoto"
          loading="eager"
        />
      ) : null}

      <p className="landmarkChapterHistory">{landmark.history}</p>
      <a
        className="landmarkChapterSource"
        href={landmark.source.url}
        target="_blank"
        rel="noreferrer"
      >
        Source: {landmark.source.label}
        <ExternalLink size={14} aria-hidden="true" />
      </a>

      <div className="landmarkChapterActions">
        <a className="landmarkChapterBtn" href={mapHref}>
          Open on the map
        </a>
        {crawlIds.length > 0 ? (
          <a className="landmarkChapterBtn landmarkChapterBtnPrimary" href={startCrawlHref(crawlIds)}>
            Start a crawl here
          </a>
        ) : null}
      </div>

      {nearby.length > 0 ? (
        <section aria-labelledby="landmarkNearbyHeading">
          <h2 id="landmarkNearbyHeading" className="landmarkChapterSectionTitle">
            {STORY_PUBS_NEARBY_HEADING}
          </h2>
          <p className="landmarkChapterCaveat">{STORY_PUBS_DISTANCE_CAVEAT}</p>
          <ul className="landmarkChapterPubList">
            {nearby.map(({ venue, km }) => (
              <li key={venue.id}>
                <a href={`/map?sel=${encodeURIComponent(venue.id)}`}>
                  <span>{venue.name}</span>
                  <span className="landmarkChapterPubDist">{formatLogNearbyDistance(km)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="landmarkChapterFoot">
        Cited pub stories mapped into walks. <Link href="/crawls">Browse route packs →</Link>
      </p>
    </main>
  );
}
