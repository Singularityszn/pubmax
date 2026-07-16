import type { Metadata } from "next";

import { loadHistoricPubs } from "@/lib/historic";
import HistoricPageClient from "./HistoricPageClient";

import "./historic.css";

// Flagship "Historic Pubs" discovery surface (not the map). A browsable,
// provenance-honest index of London's notable pubs — every era, grade, and
// hook on a card is lifted from a cited Wikipedia/Wikidata fact, never invented.
// This server shell loads the pre-built, read-only dataset and hands it to the
// client component that owns filtering, sorting, and interactivity.
export const metadata: Metadata = {
  title: "London's Historic Pubs — cited from Wikipedia & Wikidata · PUBMAXXING",
  description:
    "A browsable index of London's notable, historic pubs — dates, listed-building grades, and one cited sentence each, sourced from Wikipedia and Wikidata. Never invented. Filter by borough, jump straight onto the map.",
  alternates: { canonical: "/historic" },
};

export default async function HistoricPage() {
  const pubs = await loadHistoricPubs();
  return <HistoricPageClient pubs={pubs} />;
}
