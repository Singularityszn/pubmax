import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import Kicker from "@/components/ui/kicker";
import TrustPill from "@/components/ui/trust-pill";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import {
  CONFIRMED_MAX_AGE_DAYS,
  LISTED_MAX_AGE_DAYS,
  PRICE_STANDINGS,
  priceStandingNote,
  type PriceStanding,
  type PriceStandingDecision,
} from "@/lib/priceTier";
import { MIN_ESTIMATE_SAMPLE } from "@/lib/priceEstimate";
import { estimateBaselines } from "@/lib/priceEstimateBaselines";
import { MIN_PRICED_VENUES } from "@/lib/zones";

import "../legal.css";

// /how-we-estimate - the destination every "est. £X" links to.
//
// SAME HOUSE RULE AS /privacy: this page describes what the code does. The four
// standings, the two ages and the sample floor are READ from their own modules
// rather than typed here, and the basis counts are read from the shipped
// baselines table, so a page claiming "we model from chain menus" cannot
// survive a table holding no chain rows. It has no numbers of its own to fall
// out of date.

const PAGE_TITLE = "How we estimate";
const PAGE_DESCRIPTION =
  "What a price on PUBMAXX is worth: confirmed, listed, estimated or missing, and how we model an estimate.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/how-we-estimate" },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/how-we-estimate",
    siteName: metadataSiteName(),
    type: "website",
  },
};

/**
 * The pill a reader meets beside a price, shown here with no figure in it.
 * The page names what each label means, so it shows the label itself, from
 * the one renderer every price uses, rather than a drawing of it. With no
 * figure there is no price band, so every pill here reads in neutral ink:
 * the colour on a real pill is what the figure costs, never the label.
 */
const SPECIMEN_REASON: Record<PriceStanding, PriceStandingDecision["reason"]> = {
  confirmed: "confirmed_in_window",
  listed: "listed_with_source",
  estimate: "modelled",
  none: "nothing_known",
};

function specimen(standing: PriceStanding): PriceStandingDecision {
  return {
    standing,
    reason: SPECIMEN_REASON[standing],
    priceGbp: null,
    sourceUrl: null,
    asOf: null,
    basis: null,
    sampleSize: null,
  };
}

export default function HowWeEstimatePage() {
  const baselines = estimateBaselines();
  const chains = baselines?.chains ?? [];
  const regions = baselines?.regions ?? [];

  return (
    <>
    <SiteNav />
    <main id="main" className="legalPage">
      <header className="legalHead">
        <Kicker>Prices</Kicker>
        <h1 className="legalTitle">How we estimate</h1>
        <p className="legalLede">
          Each figure says whether it is confirmed, listed or estimated.
          If we have no price, we say so.
        </p>
      </header>

      <section className="legalSection" aria-labelledby="standings">
        <h2 id="standings" className="legalH2">What the labels mean</h2>
        <ul className="legalPanelList">
          {PRICE_STANDINGS.map((standing) => (
            <li key={standing} data-standing-definition={standing}>
              <span className="legalTerm">
                <TrustPill decision={specimen(standing)} />
              </span>
              {priceStandingNote(standing)}
            </li>
          ))}
        </ul>
        <p className="legalBody">
          The label is always a word. Beside a real price the pill also takes
          that price&rsquo;s colour: green for a cheap pint, yellow for an
          average one, red for a dear one.
        </p>
        <p className="legalBody">
          A confirmation lasts {CONFIRMED_MAX_AGE_DAYS} days.
          We can label a price Listed for up to {LISTED_MAX_AGE_DAYS} days from the day
          we read its source. After that, we use whichever weaker label the remaining
          evidence supports.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="estimate">
        <h2 id="estimate" className="legalH2">What an estimate is</h2>
        <p className="legalBody">
          An estimate is a figure we modelled. Nobody published it, no drinker
          reported it, and the pub has not agreed to it. That is why it always
          reads <strong>est. £X</strong> and never a plain price, and why it
          never reaches the Pint Index, the cheapest-pint lists, or anything else
          that quotes a price as fact.
        </p>
        <p className="legalBody">
          Our baseline table uses two bases and tries the narrower one first.
        </p>
        <ul className="legalPanelList">
          <li>
            <strong>Chain menu prices.</strong>{" "}Where a chain runs the pub and
            publishes a menu we are permitted to read, we take the middle price
            across that chain&rsquo;s own published pints.
          </li>
          <li>
            <strong>Prices nearby.</strong>{" "}Otherwise we take the middle price
            for the pub&rsquo;s own area.
          </li>
        </ul>
        <p className="legalBody">
          Each basis in that table needs at least {MIN_ESTIMATE_SAMPLE} published
          prices. With fewer prices, we do not use that basis.
        </p>
        <p className="legalBody">
          <strong>London pubs.</strong>{" "}A pub without a price in the available
          records can show a fare-zone estimate. We use each priced pub&rsquo;s
          cheapest recorded pint from the published London index and take the
          middle value for the zone. A pub takes the zone of its nearest station.
          A zone needs at least {MIN_PRICED_VENUES} priced pubs before we use it.
        </p>
        <p className="legalBody">
          A zone estimate replaces a borough baseline when available.
          A chain-menu estimate takes precedence.
        </p>
        <p className="legalBody">
          A beer&rsquo;s area price page can also show an estimate.
          It uses each qualifying pub&rsquo;s cheapest listed price for that beer
          and takes the middle value.
          It uses all qualifying pubs, including those beyond the displayed list.
          This estimate stays separate from the ranked prices.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="today">
        <h2 id="today" className="legalH2">What the baseline table holds today</h2>
        {baselines ? (
          <>
            <p className="legalBody">
              {chains.length === 0
                ? "The baseline table holds no chain-menu basis. Its estimates use the area basis."
                : `${chains.length} ${chains.length === 1 ? "chain is" : "chains are"} modelled from their own published pints.`}
            </p>
            <p className="legalBody">
              {regions.length === 0
                ? "The baseline table holds no area basis."
                : `${regions.length} ${regions.length === 1 ? "area is" : "areas are"} modelled in the baseline table. London zone estimates and estimates on beer pages use the separate methods above.`}
            </p>
            <p className="legalUpdated">
              Basis last computed{" "}
              {new Date(baselines.computedAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
            </p>
          </>
        ) : (
          <p className="legalBody">
            We could not load the baseline table. Its current coverage is
            unavailable. London zone estimates and estimates on beer pages use
            separate data.
          </p>
        )}
      </section>

      <section className="legalSection" aria-labelledby="replaced">
        <h2 id="replaced" className="legalH2">How an estimate gets replaced</h2>
        <p className="legalBody">
          By a real price. When a pub publishes its menu, or a drinker logs what
          they paid and somebody else confirms it, the estimate goes and the
          published or confirmed figure takes its place.
        </p>
        <p className="legalBody">
          <Link href="/pint-index" className="legalLink">The Pint Index</Link>{" "}
          publishes only prices with a named source
          and a date, and no estimate has ever entered it.
        </p>
      </section>
    </main>
    </>
  );
}
