import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import {
  resolveTimeMachineYear,
  rowsForYear,
  timeMachinePath,
  timeMachineShareText,
} from "@/lib/priceTimeMachine";

import TimeMachineClient from "./TimeMachineClient";
import { loadTimeMachine } from "./timeMachineData";

import "@/components/listing/listing.css";
import "./time-machine.css";

// /time-machine: the pint price time machine (launch review F1). A year
// slider over London, where a pub lights up only in a year it holds a dated,
// sourced record for, with the price that record states. Every figure here is
// history from public/data/price_history/london.json, and none of it is a
// current price (the hard rule in lib/priceHistory.ts).
//
// The year rides in `?year=` so a link shares a year, and the share card at
// ./opengraph-image reads the same year. No sign-in anywhere on this page.

const PAGE_PATH = "/time-machine";
const PAGE_TITLE = "Pint price time machine";
const PAGE_DESCRIPTION =
  "Pick a year and see what a pint cost at London pubs that year, from dated reviews anyone can open. Only pubs with a dated record light up.";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: PageProps = {}): Promise<Metadata> {
  const data = await loadTimeMachine();
  const year = data ? resolveTimeMachineYear(data, (await searchParams)?.year) : null;
  const description =
    data && year !== null
      ? `${timeMachineShareText(year, rowsForYear(data, year).length)}. ${PAGE_DESCRIPTION}`
      : PAGE_DESCRIPTION;
  const image = year !== null ? `${PAGE_PATH}/opengraph-image?year=${year}` : `${PAGE_PATH}/opengraph-image`;
  const alt = year !== null ? `Pint prices in ${year}. PUBMAXX` : "Pint price time machine. PUBMAXX";
  return {
    title: PAGE_TITLE,
    description,
    alternates: { canonical: PAGE_PATH },
    openGraph: {
      title: appPageTitle(year !== null ? `${PAGE_TITLE}: ${year}` : PAGE_TITLE),
      description,
      url: year !== null ? timeMachinePath(year) : PAGE_PATH,
      siteName: metadataSiteName(),
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt }],
    },
    twitter: {
      card: "summary_large_image",
      title: appPageTitle(PAGE_TITLE),
      description,
      images: [image],
    },
  };
}

export default async function TimeMachinePage({ searchParams }: PageProps) {
  const data = await loadTimeMachine();
  const year = data ? resolveTimeMachineYear(data, (await searchParams)?.year) : null;
  const sources = data
    ? [...new Set(Object.values(data.rowsByYear).flat().map((row) => row.sourceLabel))].sort()
    : [];

  return (
    <>
      <SiteNav />
      <main id="main" className="timeMachinePage listingShell">
        <Screen
          as="section"
          className="timeMachineScreen"
          kicker="Price history"
          title={PAGE_TITLE}
          titleId="timeMachineHeading"
          lede="Each lit pub is a price a drinker wrote down in a review on a known day. None of it is what a pint costs today."
        >
          {data && year !== null ? (
            <TimeMachineClient data={data} initialYear={year} />
          ) : (
            <p className="tmEmpty">The price history file could not be read, so there is no year to show.</p>
          )}
          <p className="tmFoot">
            {sources.length > 0
              ? `The records come from archived reviews on ${sources.join(" and ")}, each read by a person before it shipped. `
              : null}
            <Link href="/historic" className="listingLink">
              London&apos;s historic pubs
            </Link>
          </p>
        </Screen>
      </main>
    </>
  );
}
