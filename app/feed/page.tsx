import type { Metadata } from "next";

import FeedPageClient from "./FeedPageClient";
import { loadFeedSightings } from "./feedSightings.server";

// Server shell for /feed so the route carries real metadata (the client
// component can't export it). Stories is a public browse surface (like
// /discover), so it is indexable with its own canonical + Open Graph.
// A PIN on how this route already renders, not a change of mode: the root
// layout awaits headers() outside any Suspense boundary and nothing enables PPR,
// so every route in the app is dynamic today. The ambient sightings below carry
// a recency window answered against the request clock (feedSightings.server.ts),
// which a prerendered shell would freeze, so the directive says so out loud and
// stops a later layout change re-baking this page by accident.
export const dynamic = "force-dynamic";

const FEED_TITLE = "Stories";
const FEED_DESCRIPTION =
  "Recent Pint Drops from across London: logged prices, mapped pubs, and the notes passed down with them.";

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
