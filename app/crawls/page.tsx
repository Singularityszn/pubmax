import type { Metadata } from "next";

import { curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import { loadGroupedVenues } from "@/lib/venueDataset";
import { routePlacePhoto, type PlacePhoto } from "@/components/listing/placePhotoRules";
import CrawlsPageClient from "./CrawlsPageClient";
import { visibleCuratedCrawls } from "./routeSummary";

// Server shell for /crawls so the route carries real metadata (the client
// component can't export it). Crawls is a public browse surface (like /pubs
// and /discover), so it is indexable with its own canonical + Open Graph.
const CRAWLS_TITLE = "Free, self-guided London pub crawl routes";
const CRAWLS_DESCRIPTION =
  "London pub crawls you can share, with their stops, prices and vibe. Pick a route worth the walk, or build your own on the map.";

export const metadata: Metadata = {
  title: CRAWLS_TITLE,
  description: CRAWLS_DESCRIPTION,
  alternates: { canonical: "/crawls" },
  openGraph: {
    title: CRAWLS_TITLE,
    description: CRAWLS_DESCRIPTION,
    url: "/crawls",
    siteName: "PUBMAXX",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: CRAWLS_TITLE,
    description: CRAWLS_DESCRIPTION,
    images: ["/og.png"],
  },
};

// Each curated crawl's lead photograph, where one is honest: the patch every
// stop sits within a short walk of (components/listing/placePhotoRules.ts). The
// curated list is fixed, so the table is worked out once per process; a read
// that fails is not kept, so one bad render cannot leave the page bare.
let crawlPhotosPending: Promise<Record<string, PlacePhoto>> | null = null;

async function readCrawlPhotos(): Promise<Record<string, PlacePhoto>> {
  const venues = await loadGroupedVenues();
  if (venues.length === 0) throw new Error("venue dataset unavailable");
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  const photos: Record<string, PlacePhoto> = {};
  for (const crawl of curatedCrawls) {
    const points = crawl.venueIds.flatMap((id) => {
      const venue = byId.get(id);
      return venue ? [{ lat: venue.latitude, lng: venue.longitude }] : [];
    });
    // A stop we cannot place could be anywhere, so the crawl gets no photograph.
    if (points.length !== crawl.venueIds.length) continue;
    const photo = routePlacePhoto(points);
    if (photo) photos[crawl.id] = photo;
  }
  return photos;
}

async function crawlPhotos(): Promise<Record<string, PlacePhoto>> {
  const inflight = crawlPhotosPending ?? (crawlPhotosPending = readCrawlPhotos());
  try {
    return await inflight;
  } catch {
    if (crawlPhotosPending === inflight) crawlPhotosPending = null;
    return {};
  }
}

export default async function CrawlsPage({
  searchParams,
}: {
  searchParams?: Promise<{ pack?: string | string[]; s?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : {};
  const pack = Array.isArray(params.pack) ? params.pack[0] : params.pack;
  const encodedStory = Array.isArray(params.s) ? params.s[0] : params.s;
  // Only the featured crawl wears a photograph, so only its photograph ships.
  const featured: CuratedCrawl | undefined = encodedStory ? undefined : visibleCuratedCrawls(pack)[0];
  const featuredPhoto = featured ? ((await crawlPhotos())[featured.id] ?? null) : null;
  return (
    <CrawlsPageClient pack={pack} encodedStory={encodedStory} featuredPhoto={featuredPhoto} />
  );
}
