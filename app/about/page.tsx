import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import DataCreditsLink from "@/components/legal/DataCreditsLink";

import PriceBadge from "@/components/PriceBadge";
import JsonLd from "@/components/seo/JsonLd";
import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { loadAboutStats } from "@/lib/aboutStats";
import { buildLeagueTable, indexSummary, PINT_INDEX_NOT_READY_LINE, pintIndexLeagueReady } from "@/lib/pintIndex";
import { averageBasePhrase, pricedPubsSentence } from "@/lib/pricedPubCount";
import { loadPricedPubCount } from "@/lib/pricedPubCount.server";
import { priceBand } from "@/lib/priceBand";
import { loadPublicPintIndexSnapshot } from "@/lib/publicPintIndexSnapshot.server";
import { HELLO_EMAIL, HELLO_MAILTO } from "@/lib/siteContact";
import { SITE_ORGANIZATION_ID, SITE_WEBSITE_ID } from "@/lib/siteJsonLd";
import { SITE_PRODUCT_DESCRIPTION } from "@/lib/siteProductCopy";
import { loadUkDirectoryCoverage } from "@/lib/ukDirectoryCoverage.server";
import { UK_NATIONAL_ENTRY_LABEL, UK_NATIONAL_MAP_HREF } from "@/lib/ukNationalBrowse";

import "./about.css";

// /about — the founder story surface (PRD_SEARCH_GROWTH S4.5; Wave S1 of
// docs/plans/FIRST_PRINCIPLES_OUTINGS.md). One page that triples as: (1) the
// "why PUBMAXX exists" narrative, (2) a press bio + press kit, and (3) an
// investor link surface. Server component, zero client JS — it renders once
// from the bundled datasets and the site's design tokens.
//
// Provenance rule (CONTEXT.md / PRODUCT.md): every number in the traction band
// is computed at request time from the same data the map reads (lib/aboutStats)
// — no invented users, revenue, or growth metrics. The prose sticks to public
// product decisions and founder-led wording already on this page; no invented
// biography, co-founder names, or fake counts (docs/VOICE.md).

const PAGE_TITLE = "About PUBMAXX";
const PAGE_DESCRIPTION =
  `${SITE_PRODUCT_DESCRIPTION} Free to browse, with named sources where recorded. Nobody pays to rank.`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/about",
    siteName: metadataSiteName(),
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "PUBMAXX: every pint has a story",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    images: ["/og.png"],
  },
};

// One address for the whole site (lib/siteContact.ts) — /about, /privacy and
// /terms must never quote different inboxes, and only this one is monitored.

function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

function fmtGbp(n: number | null): string {
  if (n === null) return "–";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** A figure inside a sentence: the data face, in ink, with no tile around it. */
function Figure({ children }: { children: string }) {
  return <span className="aboutFigure">{children}</span>;
}

/** A pint price in a sentence wears its band, like every pint price. */
function Pint({ gbp }: { gbp: number | null }) {
  return <PriceBadge band={priceBand(gbp)}>{fmtGbp(gbp)}</PriceBadge>;
}

export default async function AboutPage() {
  const [stats, pintIndexSnapshot, pricedPubs] = await Promise.all([
    loadAboutStats(),
    loadPublicPintIndexSnapshot(),
    // The ONE priced-pub count (lib/pricedPubCount.ts), the same read
    // /pint-index makes, so the two pages print one number on one base.
    loadPricedPubCount(),
  ]);
  const leagueReady = pintIndexLeagueReady(pintIndexSnapshot);
  const pintIndexRows = pintIndexSnapshot
    ? buildLeagueTable(pintIndexSnapshot)
    : [];
  const pintIndexSummary = indexSummary(pintIndexRows);
  const ukCoverage = loadUkDirectoryCoverage();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // The root layout publishes both referenced identities.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/about",
    isPartOf: { "@id": SITE_WEBSITE_ID },
    about: { "@id": SITE_ORGANIZATION_ID },
  };

  return (
    <main id="main" className="aboutPage pageHidesCreateFab">
      {/* JSON-LD is inert data, not executable script. It goes through the ONE
          hardened injector (components/seo/JsonLd), which escapes every
          HTML-significant character before the body is inlined, so a future
          dynamic field here can never break out of the script element. */}
      <JsonLd data={jsonLd} nonce={nonce} />

      {/* Wordmark + way out: same SiteNav shell as /pint-index and /plan. */}
      <SiteNav />

      {/* The launch head (docs/design/LAUNCH_SCREENS.md): kicker, the founder
          line, one lede and ONE primary. The story sections ride under it. */}
      <Screen
        as="section"
        className="aboutHero"
        kicker="About"
        title={
          <>
            A pint in London can cost eight quid. Nobody tells you where it
            doesn&rsquo;t.
          </>
        }
        titleId="about-title"
        lede={
          <>
            Find a pub, check its listed prices and send your mates a plan.
          </>
        }
        primary={<Link prefetch={false} href="/map">Open the map</Link>}
        secondary={<a href={HELLO_MAILTO}>Contact</a>}
      >

      <section className="aboutSection" aria-labelledby="map">
        <h2 id="map" className="aboutH2">What the map does</h2>
        <p className="aboutBody">{SITE_PRODUCT_DESCRIPTION}</p>
        <p className="aboutBody">
          Compare listed drink prices, read pub histories with references and
          share a plan with the stops and walking route. PUBMAXX is free to use.
        </p>
        <p className="aboutBody">
          Browse and save pubs on this device without an account. Create a plan
          and send an invite link to your mates. Sign in to sync your saves, log
          prices and use Social when it is available.
        </p>
        <p className="aboutBody">
          You can also find coffee, food and alcohol-free choices. Food listings
          name their source and stay separate from pint prices.
        </p>
      </section>

      <section className="aboutSection" aria-labelledby="fights">
        <h2 id="fights" className="aboutH2">How we handle prices</h2>
        <p className="aboutBody">
          Listed prices name their publisher when recorded and say when one is
          missing. Drinker reports show the day they were logged. Prices can
          change, so check at the bar.
        </p>
        <details className="aboutDisclosure">
          <summary>Sources, confirmation and coverage</summary>
        <ul className="aboutEthos">
          <li>
            <strong>A price needs confirmation.</strong> A single report can
            show on the pub&rsquo;s own page. It only sets the pin colour after
            a second independent drinker agrees while the report is recent
            enough. The same requirement applies to cheapest-price lists,
            soft drinks, alcohol-free drinks and logged coffee prices.
          </li>
          <li>
            <strong>Wetherspoons prices.</strong> Their public web menus don&rsquo;t
            give per-pub drink prices today. Where we have no price, we say
            so.
          </li>
          <li>
            <strong>Coverage varies by city.</strong> We started with listed
            prices in London.{" "}
            {ukCoverage ? (
              <>
                The UK directory has {fmtInt(ukCoverage.pubListings)} pub listings
                and {fmtInt(ukCoverage.barListings)} bar listings from OpenStreetMap.{" "}
              </>
            ) : null}
            A listing doesn&rsquo;t mean we have its prices or know it&rsquo;s open.{" "}
            <Link prefetch={false} href={UK_NATIONAL_MAP_HREF} className="aboutLink">
              {UK_NATIONAL_ENTRY_LABEL}
            </Link>
          </li>
          <li>
            <strong>The price order is not for sale.</strong> No slot is
            sponsored today. Any future sponsorship will be labelled and kept
            out of the price order.
          </li>
          <li>
            <strong>You choose what to share.</strong> Rewards and rankings
            never depend on how much you drink. Your nights stay yours unless
            you choose to share them, and you can browse without an account.
          </li>
        </ul>
        </details>
      </section>

      <section className="aboutSection" aria-labelledby="team">
        <h2 id="team" className="aboutH2">Who builds it</h2>
        <p className="aboutBody">
          PUBMAXX is built by{" "}
          <a
            href="https://x.com/karansznx"
            target="_blank"
            rel="noreferrer"
            className="aboutLink"
          >
            Karan Manoharan
          </a>
          .
        </p>
        <p className="aboutBody">
          The London photographs on the homepage are Karan&apos;s own. They show
          the streets, pubs and places behind the map.
        </p>
        <details className="aboutDisclosure">
          <summary>A note on sources</summary>
        <figure className="aboutFounderNote">
          <blockquote className="aboutFounderQuote">
            <p className="aboutBody">
              If PUBMAXX shows you a figure, it tells you its source status: a
              named publisher where one is recorded, an honest note when a
              publisher is not recorded, or a drinker who logged it on a stated
              day. If nobody has logged a figure, it says so.
            </p>
          </blockquote>
          <figcaption className="aboutFounderSig">
            Karan Manoharan, founder of PUBMAXX
          </figcaption>
        </figure>
        </details>
      </section>

      {/* ── Traction / numbers (real, computed at request time). One
          sentence of figures, not a grid of KPI tiles. ──────────── */}
      <section className="aboutSection" aria-labelledby="traction">
        <h2 id="traction" className="aboutH2">By the numbers</h2>
        <p className="aboutBody">
          {pricedPubs.status === "degraded" ? null : <>{pricedPubsSentence(pricedPubs.count)}{" "}</>}
          Our pub price list holds{" "}
          <Figure>{fmtInt(stats.pintPricesObserved)}</Figure> pint prices,
          each with its source status shown.{" "}
          <Figure>{fmtInt(stats.historicPubsCited)}</Figure> historic pubs carry
          a cited fact, and <Figure>{fmtInt(stats.citiesCovered)}</Figure> UK
          cities are live, London first. Every figure here is counted from the
          same public data the app runs on.
        </p>
        <p className="aboutPriceLine">
          Across <Figure>{fmtInt(stats.boroughsCovered)}</Figure> London
          boroughs and neighbourhoods, the cheapest listed pint we hold is{" "}
          <Pint gbp={stats.cheapestPint} />. The dearest is{" "}
          <Pint gbp={stats.dearestPint} />. The average listed pint across{" "}
          {averageBasePhrase(stats.pubsTracked)} is{" "}
          <Pint gbp={stats.averagePint} />, the same figure the homepage gives,
          taken from each pub&rsquo;s cheapest pint.
        </p>
      </section>

      {/* ── Press appendix (kit + journalist hooks) ─────────────── */}
      <section className="aboutSection" aria-labelledby="press">
        <h2 id="press" className="aboutH2">For the press</h2>
        <details className="aboutDisclosure">
          <summary>Press details and downloads</summary>
        <dl className="aboutPressGrid">
          <div className="aboutPressRow">
            <dt>Name</dt>
            <dd>
              PUBMAXX. Website: pubmaxxing.com.
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>One line</dt>
            <dd>
              Find a pub, compare listed prices and share a plan. Free to use,
              with no paid ranking.
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Positioning</dt>
            <dd>
              London runs on its pubs. This is the app that helps you decide
              where to go for a night out, a coffee, food, or a quiet afternoon,
              what it costs, and who you&rsquo;re meeting.
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Contact</dt>
            <dd>
              <a href={HELLO_MAILTO} className="aboutLink">
                {HELLO_EMAIL}
              </a>
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Founder</dt>
            <dd>
              Karan Manoharan
              {" · "}
              <a
                href="https://x.com/karansznx"
                target="_blank"
                rel="noreferrer"
                className="aboutLink"
              >
                X
              </a>
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Also see</dt>
            <dd>
              <Link href="/pint-index" className="aboutLink">
                The Pint Index
              </Link>
              {" · "}
              <Link href="/historic" className="aboutLink">
                Historic pubs
              </Link>
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Logo</dt>
            <dd className="aboutLogoLinks">
              <a href="/icon-512.png" download className="aboutLink">
                PNG (512px)
              </a>
              {" · "}
              <a href="/favicon.svg" download className="aboutLink">
                SVG mark
              </a>
            </dd>
          </div>
        </dl>

        <div aria-labelledby="press-hooks">
          <h3 id="press-hooks" className="aboutH2">
            Facts for a piece
          </h3>
          <p className="aboutBody">
            If you&rsquo;re writing about the cost of a night out, the Pint
            Index is your angle. If you&rsquo;re writing about daytime pubs,
            coffee, food, or alcohol-free rounds, the same honesty rules apply.
          </p>
          <ul className="aboutEthos">
            {leagueReady && pintIndexSnapshot ? (
              <>
                <li>
                  <strong>London&rsquo;s pint price league table.</strong> The
                  Pint Index currently ranks{" "}
                  <strong>{fmtInt(pintIndexSummary.boroughCount)}</strong>{" "}
                  boroughs from{" "}
                  <strong>{fmtInt(pintIndexSnapshot.observations.length)}</strong>{" "}
                  dated prices across{" "}
                  <strong>{fmtInt(pintIndexSummary.pubCount)}</strong> pubs.
                </li>
                <li>
                  <strong>A price series, not a one-off headline.</strong> Only
                  prices with a public source and date enter the Index. Closed
                  months keep their own frozen edition.
                </li>
              </>
            ) : (
              <li>{PINT_INDEX_NOT_READY_LINE}</li>
            )}
          </ul>
          <p className="aboutBody">
            <Link href="/pint-index" className="aboutLink">
              {leagueReady
                ? "See the league table"
                : "See the borough list"}
            </Link>
          </p>
        </div>
        </details>
      </section>

      <section className="aboutSection aboutCta" aria-labelledby="cta">
        <h2 id="cta" className="aboutH2">Open the map</h2>
        <p className="aboutBody">
          Start on the map, or say hello.
        </p>
        <p className="aboutBody aboutCtaRow">
          <Link prefetch={false} href="/map" className="aboutLink">
            Open the map
          </Link>
          {" · "}
          <a href={HELLO_MAILTO} className="aboutLink">
            Get in touch
          </a>
        </p>
      </section>

      <section className="aboutSection aboutCredits" aria-labelledby="credits">
        <h2 id="credits" className="aboutH2">Data &amp; sources</h2>
        <ul className="aboutSourceList">
          <li>
            Listed-building status comes from Historic England&apos;s National
            Heritage List for England (NHLE), &copy; Historic England, licensed
            under the{" "}
            <a
              href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
              target="_blank"
              rel="noopener noreferrer"
              className="aboutLink"
            >
              Open Government Licence v3.0
            </a>
            . Each listed fact links to its official list entry.
          </li>
          <li>Pub histories cite Wikipedia and Wikidata.</li>
          <li>Mapping data is &copy; OpenStreetMap contributors.</li>
          <li>
            <DataCreditsLink className="aboutLink">Every source and its licence</DataCreditsLink>
          </li>
        </ul>
      </section>
      </Screen>
    </main>
  );
}
