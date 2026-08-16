import type { Metadata } from "next";

import { parseOutDayWindow, selectOutListings } from "@/lib/outListings";
import { loadWhatsOn } from "@/lib/whatsOnStore";

import OutClient from "./OutClient";

const PAGE_TITLE = "Out";
const PAGE_DESCRIPTION =
  "What's on in London. Live music, quiz nights, and events from sourced listings. Open a plan when you have one.";

export const metadata: Metadata = {
  title: `${PAGE_TITLE} · PUBMAXXING`,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/out" },
  openGraph: {
    title: `${PAGE_TITLE} · PUBMAXXING`,
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/out",
    siteName: "PUBMAXXING",
    type: "website",
  },
};

export const runtime = "nodejs";

export default async function OutPage({
  searchParams,
}: {
  searchParams?: Promise<{ day?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const day = parseOutDayWindow(params.day);
  // No `limit` here: the What's-On read slices in dataset order, so a cap spent
  // there is spent on deal rows this page discards. Filter to the kinds and the
  // window first, then cap what is left. Filtering on the server also settles
  // the window against ONE clock, so the list cannot change under hydration.
  const listings = await loadWhatsOn();
  const rows = selectOutListings(listings.rows, day);
  return (
    <OutClient
      day={day}
      rows={rows}
      kindObservedAt={listings.kindObservedAt}
      readStatus={listings.revalidation.status === "measured" ? "ready" : "degraded"}
    />
  );
}
