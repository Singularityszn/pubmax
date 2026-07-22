import type { Metadata } from "next";

import FeedPageClient from "./FeedPageClient";

// Server shell for /feed so the route carries real metadata (the client
// component can't export it). The Pint Feed is a public browse surface (like
// /discover), so it is indexable with its own canonical + Open Graph.
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

export default function FeedPage() {
  return <FeedPageClient />;
}
