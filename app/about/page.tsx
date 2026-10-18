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
import { buildLeagueTable, indexSummary } from "@/lib/pintIndex";
import { priceBand } from "@/lib/priceBand";
import { loadPublicPintIndexSnapshot } from "@/lib/publicPintIndexSnapshot.server";
import { HELLO_EMAIL, HELLO_MAILTO } from "@/lib/siteContact";

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
  "A pint in London can cost eight quid. PUBMAXX puts listed prices on one map for nights out, coffee, food, and sober hangs. We name and link publishers when recorded, and say when none is recorded. Free, and nobody pays to rank.";

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
  const [stats, pintIndexSnapshot] = await Promise.all([
    loadAboutStats(),
    loadPublicPintIndexSnapshot(),
  ]);
  const pintIndexRows = pintIndexSnapshot
    ? buildLeagueTable(pintIndexSnapshot)
    : [];
  const pintIndexSummary = indexSummary(pintIndexRows);
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // AboutPage + Organization JSON-LD. NOTE (see agent report): components/seo/
  // JsonLd.tsx from PR #274 is NOT on this base branch, so this is inlined here
  // following the layout.tsx nonce-aware CSP pattern. If #274 lands first,
  // migrate this block to <JsonLd> and drop the inline script to avoid two
  // Organization nodes on the site.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/about",
    isPartOf: {
      "@type": "WebSite",
      name: "PUBMAXX",
      url: "https://pubmaxxing.com",
    },
    about: {
      "@type": "Organization",
      name: "PUBMAXX",
      alternateName: "PUBMAXXING",
      url: "https://pubmaxxing.com",
      logo: "https://pubmaxxing.com/icon-512.png",
      description:
        "Listed prices with explicit source status for UK pubs, mapped for nights out, daytime hangs, food, coffee, and alcohol-free rounds. A free outing planner that never lets anyone pay to rank.",
      email: HELLO_EMAIL,
      founder: {
        "@type": "Person",
        name: "Karan Manoharan",
        url: "https://x.com/karansznx",
      },
      sameAs: ["https://x.com/karansznx"],
    },
  };

  return (
    <main id="main" className="aboutPage">
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
        <p className="aboutBody">
          We put real prices on the map, starting in London. When a price record
          names a publisher, we name and link it. When no publisher is recorded,
          the price says so. The ones logged by drinkers carry the day they were
          seen. Tap a pub and you see what a drink costs before you walk in.
        </p>
        <p className="aboutBody">
          A first report can mark a pub straight away. Its price only changes
          the pin colour and cheapest-price lists after a second independent
          drinker confirms it.
        </p>
        <p className="aboutBody">
          Pub histories come with references, so you can read where each story
          came from.
        </p>
        <p className="aboutBody">
          Send your crew one plan link with the stops and walking route.
        </p>
        <p className="aboutBody">
          Choose a cheap pint, coffee and a laptop at a Spoons, food then a
          soft drink, or an alcohol-free hang. Soft drink and alcohol-free prices
          share the same trust rules as beer. Coffee prices follow those rules
          once someone logs one. Food listings name their source and stay
          separate from pint prices. A drinker pays for nothing.
        </p>
        <p className="aboutBody">
          Nobody pays to rank. Sponsored listings are labelled and separate
          from the price order.
        </p>
      </section>

      <section className="aboutSection" aria-labelledby="fights">
        <h2 id="fights" className="aboutH2">How we handle prices</h2>
        <ul className="aboutEthos">
          <li>
            <strong>A price needs confirmation.</strong> A single report can
            show on the pub&rsquo;s own page. It only sets the pin colour after
            a second independent drinker agrees while the report is recent
            enough.
          </li>
          <li>
            <strong>Wetherspoons prices.</strong> Their public web menus don&rsquo;t
            give per-pub drink prices today. Where we have no price, we say
            so.
          </li>
          <li>
            <strong>Coverage varies by city.</strong> We started with listed
            prices in London. OpenStreetMap adds pubs across the country, but
            a pub on the map doesn&rsquo;t mean we hold its drink prices.
          </li>
          <li>
            <strong>The price order is not for sale.</strong> Sponsored slots
            stay labelled and separate.
          </li>
          <li>
            <strong>You can check the source.</strong> Listed prices name and link
            their publisher when recorded, and say when none is recorded. Cited
            pub stories link to their references.
          </li>
          <li>
            <strong>You choose what to share.</strong> Rewards and rankings
            never depend on how much you drink. Your nights stay yours unless
            you choose to share them, and you can browse without an account.
          </li>
        </ul>
      </section>

      <section className="aboutSection" aria-labelledby="team">
        <h2 id="team" className="aboutH2">Who builds it</h2>
        <p className="aboutBody">
          PUBMAXX is founder-led by{" "}
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
      </section>

      {/* ── Traction / numbers (real, computed at request time). One
          sentence of figures, not a grid of KPI tiles. ──────────── */}
      <section className="aboutSection" aria-labelledby="traction">
        <h2 id="traction" className="aboutH2">By the numbers</h2>
        <p className="aboutBody">
          PUBMAXX holds a price for <Figure>{fmtInt(stats.pubsTracked)}</Figure>{" "}
          pubs from <Figure>{fmtInt(stats.pintPricesObserved)}</Figure> logged
          pint prices, each with its source status shown.{" "}
          <Figure>{fmtInt(stats.historicPubsCited)}</Figure> historic pubs carry
          a cited fact, and <Figure>{fmtInt(stats.citiesCovered)}</Figure> UK
          cities are live, London first. Every figure here is counted from the
          same public data the app runs on.
        </p>
        <p className="aboutPriceLine">
          Across <Figure>{fmtInt(stats.boroughsCovered)}</Figure> London
          boroughs and neighbourhoods, the cheapest pint we&rsquo;ve logged is{" "}
          <Pint gbp={stats.cheapestPint} />. The dearest is{" "}
          <Pint gbp={stats.dearestPint} />. The average of all{" "}
          <Figure>{fmtInt(stats.pintPricesObserved)}</Figure> logged prices is{" "}
          <Pint gbp={stats.averagePint} />.
        </p>
      </section>

      {/* ── Press appendix (kit + journalist hooks) ─────────────── */}
      <section className="aboutSection" aria-labelledby="press">
        <h2 id="press" className="aboutH2">Press appendix</h2>
        <dl className="aboutPressGrid">
          <div className="aboutPressRow">
            <dt>Name</dt>
            <dd>PUBMAXX, always with two Xs. It lives at pubmaxxing.com.</dd>
          </div>
          <div className="aboutPressRow">
            <dt>One line</dt>
            <dd>
              Listed prices with explicit source status, one map for nights out
              and daytime hangs, and a plan you can send. Free, and nobody pays
              to rank.
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
            {pintIndexRows.length > 0 && pintIndexSnapshot ? (
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
              <li>
                <strong>No borough league yet.</strong> The public Pint Index has
                no dated prices with a public source to rank yet. Older map-only
                prices stay separate from the league.
              </li>
            )}
          </ul>
          <p className="aboutBody">
            <Link href="/pint-index" className="aboutLink">
              {pintIndexRows.length > 0
                ? "See the league table"
                : "See the Index status"}
            </Link>
          </p>
        </div>
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
