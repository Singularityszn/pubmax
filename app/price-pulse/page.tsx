import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/ui/empty-state";
import TrustPill from "@/components/ui/trust-pill";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import {
  formatPulseDay,
  NOT_CHECKED_LABEL,
  pricePulseKindLabel,
  publishedEditions,
  type PricePulseEdition,
  type PricePulseItem,
  type PricePulseSource,
} from "@/lib/pricePulse";
import { PRICE_PULSE_EDITION_FILES } from "@/lib/pricePulseEditions";
import {
  BUDGET_DAY,
  EXAMPLE_ABV_PERCENT,
  EXAMPLE_PINT_LABEL,
  EXPLAINER_RATES,
  EXPLAINER_VIEWS,
  formatPintMoney,
  splitPintPrice,
} from "@/lib/pricePulseExplainer";
import { confirmedPricesForEditions, type PulseConfirmedPrice } from "@/lib/pricePulse.server";

import "../legal.css";
import "./price-pulse.css";

// /price-pulse - what people are saying about pint prices this week, and where
// the money in a £6 pint goes.
//
// TWO HALVES, TWO GATES. An edition is research about other people's words, so
// it renders only once the owner has approved it (`publishedEditions` is the
// one gate, lib/pricePulse.ts). The explainer is our own sourced arithmetic and
// is reviewed in the commit that changes it, so it always renders.
//
// No figure on this page is a PUBMAXX price. A line prints "Not checked by
// PUBMAXX" unless the pub it names holds a Confirmed price, and then that price
// sits beside the claim with its own date. Nothing here flows back to a pin.

const PAGE_PATH = "/price-pulse";
const PAGE_TITLE = "Price Pulse";
const PAGE_DESCRIPTION =
  "What drinkers and the trade are saying about pint prices, with a link and a date on every line, and where the money in a £6 pint goes.";

export const metadata: Metadata = {
  title: `${PAGE_TITLE}: what people are saying about pint prices`,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_PATH },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: `https://pubmaxxing.com${PAGE_PATH}`,
    siteName: metadataSiteName(),
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
  },
};

function SourceLink({ source, dateMeans = "published" }: { source: PricePulseSource; dateMeans?: "published" | "in force from" }) {
  const day = formatPulseDay(source.publishedOn);
  return (
    <a
      className="legalLink pulseSourceLink"
      href={source.url}
      rel="noopener noreferrer nofollow"
      target="_blank"
    >
      {source.label}, {dateMeans === "in force from" ? `in force from ${day}` : day}
    </a>
  );
}

function PulseItem({ item, confirmed }: { item: PricePulseItem; confirmed: PulseConfirmedPrice | null }) {
  return (
    <li className="pulseItem" data-kind={item.kind}>
      <p className="pulseItemKind">{pricePulseKindLabel(item.kind)}</p>
      <p className="pulseItemSaid">{item.said}</p>
      {item.quote ? (
        <figure className="pulseQuote">
          <blockquote>
            <p>&ldquo;{item.quote.text}&rdquo;</p>
          </blockquote>
          <figcaption>{item.quote.attribution}</figcaption>
        </figure>
      ) : null}
      <p className="pulseItemFoot">
        <SourceLink source={item.source} />
        {confirmed ? (
          <span className="pulseConfirmed">
            <span>Our price</span>
            <TrustPill decision={confirmed} />
          </span>
        ) : (
          <span className="pulseNotChecked">{NOT_CHECKED_LABEL}</span>
        )}
      </p>
    </li>
  );
}

function Edition({
  edition,
  prices,
  headingLevel,
}: {
  edition: PricePulseEdition;
  prices: Map<string, PulseConfirmedPrice>;
  headingLevel: "h2" | "h3";
}) {
  const Heading = headingLevel;
  const headingId = `edition-${edition.edition}-title`;
  return (
    <article className="pulseEdition" id={`edition-${edition.edition}`} aria-labelledby={headingId}>
      <p className="legalUpdated">
        Edition of {formatPulseDay(edition.edition)}. Covers {formatPulseDay(edition.windowStart)} to{" "}
        {formatPulseDay(edition.windowEnd)}.
      </p>
      <Heading id={headingId} className={headingLevel === "h2" ? "legalH2" : "legalH3"}>
        {edition.title}
      </Heading>
      <p className="legalBody">{edition.summary}</p>
      <ul className="pulseItems">
        {edition.items.map((item) => (
          <PulseItem
            key={item.id}
            item={item}
            confirmed={item.venueId ? (prices.get(item.venueId) ?? null) : null}
          />
        ))}
      </ul>
    </article>
  );
}

function WhereYourSixGoes() {
  const split = splitPintPrice();
  const parts = [
    { id: "vat", label: "VAT", gbp: split.vatGbp },
    { id: "duty", label: "Beer duty", gbp: split.dutyGbp },
    { id: "rest", label: "Everything else", gbp: split.restGbp },
  ] as const;
  const rate = (id: "vat" | "duty") => EXPLAINER_RATES.find((r) => r.id === id);

  return (
    <section className="legalSection pulseExplainer" id="where-your-6-goes" aria-labelledby="where-your-6-goes-title">
      <h2 id="where-your-6-goes-title" className="legalH2">
        Where your {EXAMPLE_PINT_LABEL} goes
      </h2>
      <p className="legalBody">
        A {EXAMPLE_PINT_LABEL} pint of {EXAMPLE_ABV_PERCENT}% draught lager, split by
        the tax rates the government publishes.
      </p>

      <div className="pulseSplitBar" aria-hidden="true">
        {parts.map((part) => (
          <span
            key={part.id}
            className={`pulseSplitSegment pulseSplitSegment--${part.id}`}
            style={{ flexGrow: part.gbp }}
          />
        ))}
      </div>

      <dl className="pulseSplit">
        {parts.map((part) => {
          const r = part.id === "rest" ? undefined : rate(part.id);
          return (
            <div key={part.id} className="pulseSplitRow" data-part={part.id}>
              <dt>
                <i className={`pulseSplitKey pulseSplitSegment--${part.id}`} aria-hidden="true" />
                {part.label}
              </dt>
              <dd className="pulseSplitFigure">{formatPintMoney(part.gbp)}</dd>
              <dd className="pulseSplitNote">
                {r ? (
                  <>
                    {r.rateNote}. <SourceLink source={r.source} dateMeans={r.dateMeans} />
                  </>
                ) : (
                  "The beer, the staff, the rent, the energy, the business rates and any profit. We do not split this for any pub."
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="pulseViews">
        {EXPLAINER_VIEWS.map((view) => (
          <section key={view.id} className="pulseView" aria-labelledby={`view-${view.id}`}>
            <h3 id={`view-${view.id}`} className="legalH3">{view.heading}</h3>
            <ul className="pulseViewPoints">
              {view.points.map((point) => (
                <li key={point.source.url}>
                  <p>{point.said}</p>
                  <SourceLink source={point.source} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="legalBody">
        The UK Budget is on {formatPulseDay(BUDGET_DAY)}. If it changes duty or VAT, we change these
        figures.
      </p>
    </section>
  );
}

export default async function PricePulsePage() {
  const editions = publishedEditions(PRICE_PULSE_EDITION_FILES);
  const [latest, ...archive] = editions;
  const prices = await confirmedPricesForEditions(editions);

  return (
    <>
      <SiteNav />
      <main id="main" className="legalPage pricePulsePage">
        <header className="legalHead">
          <p className="legalEyebrow">Price Pulse</p>
          <h1 className="legalTitle">What people are saying about pint prices</h1>
          <p className="legalLede">
            A figure on this page is what someone said or published. It is not a PUBMAXX price.
          </p>
        </header>

        {latest ? (
          <Edition edition={latest} prices={prices} headingLevel="h2" />
        ) : (
          <EmptyState title="No edition is published yet">
            Each edition is checked by hand before it goes up.
          </EmptyState>
        )}

        <WhereYourSixGoes />

        {archive.length > 0 ? (
          <section className="legalSection" aria-labelledby="pulse-archive-title">
            <h2 id="pulse-archive-title" className="legalH2">Earlier editions</h2>
            {archive.map((edition) => (
              <details key={edition.edition} className="pulseArchiveEntry">
                <summary>
                  {edition.title}, {formatPulseDay(edition.edition)}
                </summary>
                <Edition edition={edition} prices={prices} headingLevel="h3" />
              </details>
            ))}
          </section>
        ) : null}

        <p className="legalBody pulseFoot">
          <Link href="/how-we-estimate" className="legalLink">How we label a price</Link>
        </p>
      </main>
    </>
  );
}
