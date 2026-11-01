import type { Metadata } from "next";

import NearPageClient from "@/components/nearme/NearPageClient";
import { loadNearDrinkLanes } from "@/lib/nearCheapestAnything.server";
import { loadNearGuinnessPrices } from "@/lib/nearGuinness.server";
import { loadPintRouletteFacts } from "@/lib/pintRouletteFacts.server";

// The instant-answer surface (Cycle 3, Lane 1): geolocate → the cheapest good
// pints within a short walk, as immediate cards. No map needed to reach the
// answer. noindex — this is a per-user, location-dependent view, not a
// crawlable page (the borough pages carry the indexable price content).
export const metadata: Metadata = {
  title: "Find my pint. Nearby London pint prices",
  description:
    "PUBMAXX compares listed pint prices near you, cheapest first. Use your location or pick a London patch.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/near" },
};

// THIS DOCUMENT IS PRERENDERED (captain 2026-09-05, "Widen", recorded in
// proxy.ts beside CDN_CACHED_DOCUMENT_PATHS): it drops the per-request CSP
// nonce so the Vercel CDN can hold it. The document is a client shell: the
// viewer's location, the remembered patch and `?locate=1` are all read after
// load, so nothing per-request and nothing personal is rendered here.
// `__tests__/cdnCachedDocuments.test.ts` holds both rules.
export const dynamic = "force-static";
// Nothing in this document changes between deploys, so an hour is the same
// quiet ceiling `/map` takes: it bounds how long a stale copy can outlive a
// change nobody redeployed for.
export const revalidate = 3600;

// The Guinness line's rows, the Cheapest anything rows and the roulette's
// stored facts are bundled data read at build, the same reads /drink/guinness,
// /soft-drinks-and-water and the round forecast make, so the prerendered
// document stays the same for every visitor. The ranking against the viewer's
// spot, and the roulette's spin, run in the browser.
export default async function NearPage() {
  const [guinnessPrices, drinkLanes, rouletteFacts] = await Promise.all([
    loadNearGuinnessPrices(),
    loadNearDrinkLanes(),
    loadPintRouletteFacts(),
  ]);
  return (
    <NearPageClient
      guinnessPrices={guinnessPrices}
      drinkLanes={drinkLanes}
      rouletteFacts={rouletteFacts}
    />
  );
}
