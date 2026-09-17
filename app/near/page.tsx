import type { Metadata } from "next";

import NearPageClient from "@/components/nearme/NearPageClient";

// The instant-answer surface (Cycle 3, Lane 1): geolocate → the cheapest good
// pints within a short walk, as immediate cards. No map needed to reach the
// answer. noindex — this is a per-user, location-dependent view, not a
// crawlable page (the borough pages carry the indexable price content).
export const metadata: Metadata = {
  title: "Find my pint. Nearby London pint prices",
  description:
    "Compare listed pint prices near you, cheapest first. Use your location or pick a London patch.",
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

export default function NearPage() {
  return <NearPageClient />;
}
