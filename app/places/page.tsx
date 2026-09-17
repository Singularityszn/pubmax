import type { Metadata } from "next";

import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { PLACES_PATH, parsePlacesCityParam } from "@/lib/places";

import PlacesClient from "./PlacesClient";

import "./Places.module.css";

const PAGE_TITLE = "Places";
const PAGE_DESCRIPTION =
  "Pick the city PUBMAXXING opens on. Listed pint prices where we have them, the patches inside each city, and the same choice for the map, Out and Near.";

// /places is the ONE city list, and the page the canonical names. It used to
// ship `noindex` while /choose-city carried the canonical and the sitemap row;
// both moved here in the same commit as the /choose-city 308 (proxy.ts),
// because a 308 from the canonical page to a noindex page takes the city list
// out of the index instead of moving it. Two indexable pages for one list is
// the thing being prevented, and there is now only one.
export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PLACES_PATH },
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
