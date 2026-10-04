import type { Metadata } from "next";
import Link from "next/link";

import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import {
  CONFIRMED_MAX_AGE_DAYS,
  LISTED_MAX_AGE_DAYS,
  PRICE_STANDINGS,
  priceStandingLabel,
  priceStandingNote,
} from "@/lib/priceTier";
import { MIN_ESTIMATE_SAMPLE } from "@/lib/priceEstimate";
import { estimateBaselines } from "@/lib/priceEstimateBaselines";

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
  "What a price on PubMaxxing is worth: confirmed, listed, estimated or missing, and exactly how an estimate is modelled.";

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

export default function HowWeEstimatePage() {
  const baselines = estimateBaselines();
  const chains = baselines?.chains ?? [];
  const regions = baselines?.regions ?? [];

  return (
    <main id="main" className="legalPage">
      <header className="legalHead">
        <p className="legalEyebrow">Prices</p>
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
            <li key={standing}>
              <strong>{priceStandingLabel(standing)}.</strong>{" "}
              {priceStandingNote(standing)}
            </li>
          ))}
        </ul>
        <p className="legalBody">
          A confirmation lasts {CONFIRMED_MAX_AGE_DAYS} days. A listed menu
          price lasts {LISTED_MAX_AGE_DAYS} days. After that, we use whichever
          weaker label the remaining evidence supports.
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
          We model from two bases and try the narrower one first.
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
          A basis needs at least {MIN_ESTIMATE_SAMPLE} published prices behind
          it. With fewer prices, we show no estimate.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="today">
        <h2 id="today" className="legalH2">What we are modelling from today</h2>
        {baselines ? (
          <>
            <p className="legalBody">
              {chains.length === 0
                ? "No chain is modelled yet. No chain we are permitted to read has published a pint price, so every estimate today comes from the area basis instead."
                : `${chains.length} ${chains.length === 1 ? "chain is" : "chains are"} modelled from their own published pints.`}
            </p>
            <p className="legalBody">
              {regions.length === 0
                ? "No area is modelled yet, so no pub carries an estimate."
                : `${regions.length} ${regions.length === 1 ? "area is" : "areas are"} modelled. Every other pub in the country carries no estimate, and says so.`}
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
            We could not load the estimate data. This page cannot show which
            prices we used to model the estimates.
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
  );
}
