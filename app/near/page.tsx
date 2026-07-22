import type { Metadata } from "next";

import NearPageClient from "@/components/nearme/NearPageClient";

// The instant-answer surface (Cycle 3, Lane 1): geolocate → the cheapest good
// pints within a short walk, as immediate cards. No map needed to reach the
// answer. noindex — this is a per-user, location-dependent view, not a
// crawlable page (the borough pages carry the indexable price content).
export const metadata: Metadata = {
  title: "Find my pint. Cheapest pints near you now",
  description:
    "The cheapest good pints within a short walk, right now. Use your location or pick a London patch — PUBMAXX ranks the nearest priced pubs by price.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/near" },
};

export default function NearPage() {
  return <NearPageClient />;
}
