import type { Metadata } from "next";

import FeedPageClient from "./FeedPageClient";
import { loadFeedSightings } from "./feedSightings.server";

// Server shell for /feed so the route carries real metadata (the client
// component can't export it). The Pint Feed is a public browse surface (like
// /discover), so it is indexable with its own canonical + Open Graph.
// Rendered per request, not baked at build: the ambient sightings below carry a
// recency window, and a prerendered shell would keep serving rows that aged out
// of it between deploys (feedSightings.server.ts).
export const dynamic = "force-dynamic";

const FEED_TITLE = "The Pint Feed";
const FEED_DESCRIPTION =
  "Live Pint Drops from across London: real prices, real pubs, and the stories passed down with them. See what's being poured tonight.";

export const metadata: Metadata = {
  title: FEED_TITLE,
  description: FEED_DESCRIPTION,
  alternates: { canonical: "/feed" },
  openGraph: {
    title: FEED_TITLE,
    description: FEED_DESCRIPTION,
    url: "/feed",
    siteName: "PUBMAXX",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: FEED_TITLE,
    description: FEED_DESCRIPTION,
    images: ["/og.png"],
  },
};

export default async function FeedPage() {
  // Ambient price sightings for the London tab's cold start, resolved server-side
  // (real pub names + map links) so the surface is never a dead empty state.
  // Fail-soft: [] when the overlay/index can't be read (see feedSightings.server).
  const sightings = await loadFeedSightings();
  return <FeedPageClient sightings={sightings} />;
}
