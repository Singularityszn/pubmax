import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import Kicker from "@/components/ui/kicker";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { buildLeagueTable, formatPintIndexDate, indexSummary } from "@/lib/pintIndex";
import { pintIndexMeetsAdmissionFloor } from "@/lib/pintIndexArchive";
import { loadPublicPintIndexSnapshotOrThrow } from "@/lib/pintIndexSnapshot.server";
import CrawlCostCalculator, { type PriceSuggestion } from "./CrawlCostCalculator";

import "../legal.css";
import "./pub-crawl-cost.css";

// /pub-crawl-cost - a free tool with a permanent page (BACKLINK PLAYBOOK,
// tactics 38 to 43, docs/growth/BACKLINK_PLAYBOOK.md). Every sum is in
// lib/crawlCostCalculator.ts and tested there on normal and unusual inputs.
//
// The price is the reader's. The page offers ONE starting figure, the Pint
// Index average, and only while the Index clears its admission floor; it says
// where the figure comes from and the day it was published. With no citable
// figure the field starts empty rather than holding a number nobody measured.

const SITE_URL = "https://pubmaxxing.com";
const PAGE_TITLE = "Pub crawl cost calculator";
const PAGE_DESCRIPTION =
  "Work out what a pub crawl costs each person when your group takes turns buying rounds.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/pub-crawl-cost" },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/pub-crawl-cost`,
    siteName: metadataSiteName(),
    type: "website",
  },
};

async function priceSuggestion(): Promise<PriceSuggestion | null> {
  const snapshot = await loadPublicPintIndexSnapshotOrThrow();
  if (!pintIndexMeetsAdmissionFloor(snapshot)) return null;
  const { averageGbp } = indexSummary(buildLeagueTable(snapshot));
  if (averageGbp === null) return null;
  return {
    price: averageGbp.toFixed(2),
    label: `London Pint Index average, published ${formatPintIndexDate(snapshot.generatedAt)}`,
  };
}

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  url: `${SITE_URL}/pub-crawl-cost`,
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
  creator: { "@type": "Organization", name: "PUBMAXX", url: SITE_URL },
};

export default async function PubCrawlCostPage() {
  const [suggestion, requestHeaders] = await Promise.all([priceSuggestion(), headers()]);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;

  return (
    <>
    <JsonLd data={JSON_LD} nonce={nonce} />
    <SiteNav />
    <main id="main" className="legalPage">
      <header className="legalHead">
        <Kicker>Free tool</Kicker>
        <h1 className="legalTitle">Pub crawl cost calculator</h1>
        <p className="legalLede">
          Enter your group, your pubs and the price of a drink. See the cost for
          each person and the difference between taking turns and splitting the bill.
        </p>
      </header>

      <section className="legalSection" aria-labelledby="calculator">
        <h2 id="calculator" className="legalH2">Your crawl</h2>
        <CrawlCostCalculator suggestion={suggestion} />
      </section>

      <section className="legalSection" aria-labelledby="how">
        <h2 id="how" className="legalH2">How it works</h2>
        <p className="legalBody">
          A round is one drink for each person in the group. The number of
          rounds is the number of pubs times the drinks each person has at each
          pub. When the rounds do not divide evenly by the group, some people buy
          one more round than the others. The calculator shows how many people
          that is and the difference in their spending. It compares only the
          drinks you entered. Split the bill to balance what each person pays.
        </p>
        <p className="legalBody">
          It works in whole pence, so the totals add up exactly. It does not know
          what any real pub charges. For real prices, use{" "}
          <Link href="/pint-index" className="legalLink">the Pint Index</Link>{" "}
          or <Link href="/map" prefetch={false} className="legalLink">the map</Link>.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="link">
        <h2 id="link" className="legalH2">Link to this calculator</h2>
        <p className="legalBody">
          This address will not change:{" "}
          <span className="crawlCostUrl">{SITE_URL}/pub-crawl-cost</span>. You can
          link to it from a guide or an article at no cost.{" "}
          <Link href="/press" className="legalLink">Press and citations</Link>{" "}
          has our figures and the credit line.
        </p>
      </section>
    </main>
    </>
  );
}
