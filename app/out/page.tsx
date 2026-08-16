import type { Metadata } from "next";

import { parseOutDayWindow } from "@/lib/outListings";
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
  const listings = await loadWhatsOn({ limit: 80 });
  return (
    <OutClient day={day} rows={listings.rows} />
  );
}
