import type { Metadata } from "next";

import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { parsePlacesCityParam } from "@/lib/places";

import PlacesClient from "./PlacesClient";

import "./places.css";

const PAGE_TITLE = "Places";
const PAGE_DESCRIPTION =
  "Pick the city PUBMAXXING opens on. Listed pint prices where we have them, the patches inside each city, and the same choice for the map, Out and Near.";

// /places is NOT a crawlable family. It is the same city list /choose-city
// already publishes, so two indexable pages would compete for one canonical:
// the shape /area/{slug} was held back for (captain decision 2026-08-15). It
// carries no canonical and is absent from the sitemap; /choose-city keeps both.
// The Open Graph tags stay, because a shared link still deserves a card and
// `og:` is not an indexing instruction.
export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  robots: {
    index: false,
    follow: true,
    googleBot: { index: false, follow: true },
  },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/places",
    siteName: metadataSiteName(),
    type: "website",
  },
};

export const runtime = "nodejs";

export default async function PlacesPage({
  searchParams,
}: {
  searchParams?: Promise<{ city?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : {};
  const raw = Array.isArray(params.city) ? params.city[0] : params.city;
  return <PlacesClient cityId={parsePlacesCityParam(raw)} />;
}
