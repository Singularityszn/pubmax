import type { Metadata } from "next";
import Link from "next/link";

import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { DATA_CREDITS, DATA_CREDITS_PATH } from "@/lib/dataCredits";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact";

import "../legal.css";

// /credits - every outside source PUBMAXX shows data from, its licence and the
// credit it asks for. Server component, zero client JS, on the legal shell.
//
// SAME HOUSE RULE AS /privacy: the page describes what the code does. The
// sources are READ from lib/dataCredits.ts, the one table every committed pack
// with a licence is held to, so a source cannot reach a screen without a line
// here.

const PAGE_TITLE = "Data credits";
const PAGE_DESCRIPTION =
  "Where PUBMAXX data comes from: every outside source, the licence it is used under and the credit it asks for.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: DATA_CREDITS_PATH },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: `https://pubmaxxing.com${DATA_CREDITS_PATH}`,
    siteName: metadataSiteName(),
    type: "website",
  },
};

export default function DataCreditsPage() {
  return (
    <main id="main" className="legalPage">
      <header className="legalHead">
        <p className="legalEyebrow">Small print</p>
        <h1 className="legalTitle">Where our data comes from</h1>
        <p className="legalLede">
          Most of what you see on PUBMAXX is other people&rsquo;s open data, and
          the prices are what drinkers logged. Every outside source is below,
          with the licence we use it under and the credit it asks for.
        </p>
      </header>

      <section className="legalSection" aria-labelledby="notice">
        <h2 id="notice" className="legalH2">Data licence notice</h2>
        <p className="legalBody">
          The PUBMAXX code is ours. The data below is not: it belongs to its
          publishers and is used under the licence named beside it. A fact on a
          pub&rsquo;s sheet names its source and the day we read it. Where a
          source says nothing about a pub, the sheet says nothing either. We
          never read a missing value as a &ldquo;no&rdquo;.
        </p>
        <p className="legalBody">
          OpenStreetMap data is &copy; OpenStreetMap contributors and available
          under the{" "}
          <a href="https://opendatacommons.org/licenses/odbl/1-0/" className="legalLink">
            Open Database Licence
          </a>
          . Each source keeps its own file, so OpenStreetMap data is never mixed
          into another publisher&rsquo;s.
        </p>
      </section>

      <section className="legalSection" aria-labelledby="sources">
        <h2 id="sources" className="legalH2">The sources</h2>
        <dl className="legalRows" data-credits-list="">
          {DATA_CREDITS.map((credit) => (
            <div key={credit.id} className="legalRow" data-credit={credit.id}>
              <dt>{credit.name}</dt>
              <dd>
                <p className="legalBody">{credit.usedFor}</p>
                <p className="legalBody">
                  <strong>Credit:</strong> {credit.attribution}
                </p>
                <p className="legalBody">
                  <strong>Licence:</strong>{" "}
                  {credit.licence ? (
                    <a href={credit.licence.url} className="legalLink">
                      {credit.licence.name}
                    </a>
                  ) : (
                    "Used under the publisher's own terms."
                  )}
                  {" · "}
                  <a href={credit.sourceUrl} className="legalLink">
                    Source
                  </a>
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="legalSection" aria-labelledby="yours">
        <h2 id="yours" className="legalH2">What drinkers add</h2>
        <p className="legalBody">
          Prices, Pint Drops and visit reports come from Pubmaxxers, each dated
          the day it was logged. How a price earns its label is on{" "}
          <Link prefetch={false} href="/how-we-estimate" className="legalLink">
            how we estimate
          </Link>
          .
        </p>
      </section>

      <section className="legalSection" aria-labelledby="wrong">
        <h2 id="wrong" className="legalH2">Missing a credit?</h2>
        <p className="legalBody">
          If you publish something we show and the credit here is wrong, write to{" "}
          <a href={CONTACT_MAILTO} className="legalLink">{CONTACT_EMAIL}</a>
          {" "}and we will fix it.
        </p>
      </section>
    </main>
  );
}
