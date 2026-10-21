import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { routePlacePhoto, type PlacePhoto } from "@/components/listing/placePhotoRules";
import { getCrawlStoryBySlug, type DurableStory } from "@/lib/crawlStoryStore";
import { loadGroupedVenues } from "@/lib/venueDataset";
import { formatGbp } from "@/lib/formatGbp";
import CrawlStoryPoster from "./CrawlStoryPoster";

import "./story.css";

// Durable Crawl Story permalink: /crawls/[slug]. A SERVER component — it reads
// the story straight from the store (pub names resolved server-side, PRD §9),
// hands it to the poster (CrawlStoryPoster.tsx), and never ships venueIndex to
// the client. An unknown OR draft slug resolves to null (a draft is private —
// there is no auth yet, so nobody can view it) → a friendly empty state, not a
// 500.
//
// Next 16 dynamic route params are async — `params` is a Promise we await.

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const story = await getCrawlStoryBySlug(slug);
  // A missing OR draft story (getCrawlStoryBySlug already withholds drafts) gets
  // generic, non-indexed metadata — an unpublished crawl must never leak a title
  // or a share card.
  if (!story) {
    return {
      title: "Crawl Story",
      robots: { index: false, follow: false },
    };
  }

  const title = story.title;
  const completePrice = story.stops.length > 0 && story.stops.every((stop) => typeof stop.priceGbp === "number");
  const topTag = story.vibeTags[0];
  const cardParams = new URLSearchParams();
  cardParams.set("title", title);
  cardParams.set("stops", String(story.stops.length));
  if (completePrice && story.totalGbp > 0) cardParams.set("total", story.totalGbp.toFixed(2));
  if (topTag) cardParams.set("tag", topTag);
  const cardUrl = `/api/crawl-card?${cardParams.toString()}`;

  const description =
    story.summary ||
    `A London pub crawl. ${story.stops.length} stop${story.stops.length === 1 ? "" : "s"}${
      completePrice && story.totalGbp > 0 ? `, ${formatGbp(story.totalGbp)} a round` : ""
    }.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: cardUrl, width: 1200, height: 630, alt: `${title}, a London crawl` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [cardUrl],
    },
  };
}

// The story's lead photograph, where one is honest: a photograph of the patch
// EVERY stop is a short walk from (components/listing/placePhotoRules.ts). A stop
// the dataset cannot place could be anywhere, so then there is none.
async function storyPhoto(story: DurableStory): Promise<PlacePhoto | null> {
  if (story.stops.length === 0) return null;
  const venues = await loadGroupedVenues();
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  const points = story.stops.flatMap((stop) => {
    const venue = byId.get(stop.venueId);
    return venue ? [{ lat: venue.latitude, lng: venue.longitude }] : [];
  });
  return points.length === story.stops.length ? routePlacePhoto(points) : null;
}

export default async function CrawlStoryPage({ params }: PageProps) {
  const { slug } = await params;
  const story = await getCrawlStoryBySlug(slug);
  if (!story) notFound();

  return (
    <main id="main" className="storyShell">
      <nav className="storyNav" aria-label="Site navigation">
        <Link href="/">Home</Link>
        <Link prefetch={false} href="/map">
          Map
        </Link>
        <Link prefetch={false} href="/social?tab=discover">
          Explore
        </Link>
      </nav>

      <CrawlStoryPoster story={story} slug={slug} photo={await storyPhoto(story)} />
    </main>
  );
}
