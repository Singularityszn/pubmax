import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import {
  SPOONS_VALUE_FIGURE_LABEL,
  SPOONS_VALUE_MAP_HREF,
  SPOONS_VALUE_NOT_AFFILIATED_LINE,
  SPOONS_VALUE_NOT_OUR_FIGURE_LINE,
  SPOONS_VALUE_PAGE_TITLE,
  SPOONS_VALUE_ROUTE,
  spoonsValueCreditLine,
  spoonsValueLede,
  spoonsValueCuts,
  toTableRow,
} from "@/lib/spoonsValue";
import { readSpoonsValue } from "@/lib/spoonsValue.server";

import SpoonsValueTable from "./SpoonsValueTable";

import "./spoons-value.css";

const SITE_URL = "https://pubmaxxing.com";

// A PUBLIC READING SURFACE, gated exactly as a price surface is: that is, not
// at all. lib/adultGate.ts governs CONTRIBUTING (a price, a photo, a Social
// post), and this page takes nothing from anybody. It states what a published
// menu costs, which is the same kind of claim /borough and /pint-index make.
export const metadata: Metadata = {
  title: `${SPOONS_VALUE_PAGE_TITLE} · PUBMAXX`,
  description:
    "Every UK Wetherspoon ranked by the alcohol units the best £10 round holds, with the round itself beside each pub.",
  alternates: { canonical: SPOONS_VALUE_ROUTE },
  openGraph: {
    title: SPOONS_VALUE_PAGE_TITLE,
    description:
      "Every UK Wetherspoon ranked by what a tenner actually buys, with the round beside each pub.",
    type: "website",
    url: SPOONS_VALUE_ROUTE,
  },
  twitter: {
    card: "summary_large_image",
    title: SPOONS_VALUE_PAGE_TITLE,
    description: "Every UK Wetherspoon ranked by what a tenner actually buys.",
  },
};

export default async function SpoonsValuePage() {
  // Per-request CSP nonce (proxy.ts) for the JSON-LD block, as every other
  // JsonLd call site passes: see components/seo/JsonLd.tsx for why a data
  // block takes one.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const read = await readSpoonsValue();

  if (read.status !== "ready" || !read.pack) {
    return (
      <>
        <SiteNav />
        <main className="spoonsPage" id="main">
          <EmptyState title={SPOONS_VALUE_PAGE_TITLE}>
            {read.status === "unavailable"
              ? "The ranking would not load. Reload the page."
              : "Nothing is ranked here yet."}
          </EmptyState>
        </main>
      </>
    );
  }

  const { pack, modalMilliunits } = read;
  const rows = pack.rows.map(toTableRow);
  const cuts = spoonsValueCuts(rows);
  const best = rows[0];
  const worst = rows.at(-1);
  const pinned = rows.filter((row) => row.venueId).length;

  // A Dataset rather than an Article: the page IS the table, and the credit
  // block names who did the reading behind it.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: SPOONS_VALUE_PAGE_TITLE,
    description: `Alcohol units per £10 at ${pack.count} UK Wetherspoon pubs, with the cheapest qualifying round beside each.`,
    url: `${SITE_URL}${SPOONS_VALUE_ROUTE}`,
    isAccessibleForFree: true,
    dateModified: pack.provenance.retrievedAt,
    creator: {
      "@type": "Person",
      name: pack.provenance.author,
    },
    publisher: { "@type": "Organization", name: "PUBMAXX", url: SITE_URL },
    isBasedOn: pack.provenance.sourceUrl,
    variableMeasured: "Alcohol units purchasable for £10, by pub",
    measurementTechnique:
      "The cheapest qualifying round under £10 read off each pub's own menu, costed and totalled in units. Every basket re-costed and re-totalled here before publication.",
  };

  return (
    <>
      <SiteNav />
      <main className="spoonsPage" id="main">
        <JsonLd data={jsonLd} nonce={nonce} />
        <Screen
          kicker="Wetherspoons, everywhere"
          title={SPOONS_VALUE_PAGE_TITLE}
          // No lede: the table IS the answer, and one short paragraph under it
          // is all the words a phone can afford above the first row.
          // The doors go under the table too (screen.tsx, actionsAfterContent).
          actionsAfterContent
          primary={
            <Link prefetch={false} href={SPOONS_VALUE_MAP_HREF}>
              See it on the map
            </Link>
          }
          secondary={
            <a href={pack.provenance.sourceUrl} rel="noopener noreferrer" target="_blank">
              Read the original report
            </a>
          }
        >
          {best && worst ? (
            <p className="spoonsLede">
              {spoonsValueLede(worst.milliunits, best.milliunits, modalMilliunits)}
            </p>
          ) : null}

          <SpoonsValueTable
            rows={rows}
            cuts={cuts}
            modalMilliunits={modalMilliunits}
          />

          <section className="spoonsCredit" aria-label="Where these figures come from">
            <h2 className="spoonsCreditTitle">Where these figures come from</h2>
            <p>
              {`${SPOONS_VALUE_NOT_OUR_FIGURE_LINE} `}
              <a href={pack.provenance.sourceUrl} rel="noopener noreferrer" target="_blank">
                {spoonsValueCreditLine(pack.provenance)}
              </a>
              {`, published ${pack.provenance.publishedAt}. ${SPOONS_VALUE_NOT_AFFILIATED_LINE}`}
            </p>
            <p>
              {`We re-costed every round and re-added every ${SPOONS_VALUE_FIGURE_LABEL.toLowerCase()} figure before publishing it, and all ${pack.count} held. `}
              {`${pinned} of them open on our map.`}
            </p>
            <p>
              Wetherspoon publishes no drink prices on its website, so we hold none of
              our own for these pubs. That&rsquo;s why we credit this ranking rather
              than measure it here, and why nothing on it touches a pint price, a pin colour
              or the Pint Index.
            </p>
          </section>
        </Screen>
      </main>
    </>
  );
}
