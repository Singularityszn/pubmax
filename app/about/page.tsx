import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { loadAboutStats, type AboutStats } from "@/lib/aboutStats";

import "./about.css";

// /about — the founder story surface (PRD_SEARCH_GROWTH S4.5). One page that
// triples as: (1) the "why PUBMAXX exists" narrative, (2) a press bio + press
// kit, and (3) an investor link surface. Server component, zero client JS — it
// renders once from the bundled datasets and the site's design tokens.
//
// Provenance rule (CONTEXT.md / PRODUCT.md): every number in the traction band
// is computed at request time from the same data the map reads (lib/aboutStats)
// — no invented users, revenue, or growth metrics. The prose is the owner's own
// narrative in brand voice; there are no fabricated third-party quotes.

const PAGE_TITLE = "Our story: why PUBMAXX exists";
const PAGE_DESCRIPTION =
  "After a hard day you want a cheap pint nearby, a couple of places, maybe to meet some people, without bouncing between Google Maps, other maps, and ChatGPT. PUBMAXX is one price-aware, story-led, map-first app for the whole night out.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    title: `${PAGE_TITLE} · PUBMAXXING`,
    description: PAGE_DESCRIPTION,
    url: "https://pubmaxxing.com/about",
    siteName: "PUBMAXXING",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "PUBMAXXING: every pint has a story",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${PAGE_TITLE} · PUBMAXXING`,
    description: PAGE_DESCRIPTION,
    images: ["/og.png"],
  },
};

const CONTACT_EMAIL = "hello@pubmaxxing.com"; // TODO-owner: confirm/route this inbox

function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

function fmtGbp(n: number | null): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

type Stat = { value: string; label: string; note: string };

function tractionStats(s: AboutStats): Stat[] {
  return [
    {
      value: fmtInt(s.pubsTracked),
      label: "pubs tracked",
      note: "distinct venues carrying a real price",
    },
    {
      value: fmtInt(s.pintPricesObserved),
      label: "pint prices observed",
      note: "individual readings from public data",
    },
    {
      value: fmtInt(s.historicPubsCited),
      label: "historic pubs cited",
      note: "one sourced fact each, never invented",
    },
    {
      value: fmtInt(s.citiesCovered),
      label: "UK cities live",
      note: "London flagship, more browseable",
    },
  ];
}

export default async function AboutPage() {
  const stats = await loadAboutStats();
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
      name: "PUBMAXXING",
      url: "https://pubmaxxing.com",
    },
    about: {
      "@type": "Organization",
      name: "PUBMAXX",
      alternateName: "PUBMAXXING",
      url: "https://pubmaxxing.com",
      logo: "https://pubmaxxing.com/icon-512.png",
      description:
        "A price-aware, story-led, map-first pub-crawl planner for the UK. Real pint prices, cited heritage, and community Pint Drops. No ads, no paywalls.",
      email: CONTACT_EMAIL,
      sameAs: ["https://x.com/karansznx"],
    },
  };

  const cheapest = fmtGbp(stats.cheapestPint);
  const average = fmtGbp(stats.averagePint);
  const dearest = fmtGbp(stats.dearestPint);

  return (
    <main className="aboutPage">
      <script
        type="application/ld+json"
        nonce={nonce}
        // JSON-LD is inert data, not executable script; serialised once on the
        // server. XSS-safe: JSON.stringify of a fixed object, no user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ── Story ──────────────────────────────────────────────── */}
      <header className="aboutHead">
        <p className="aboutEyebrow">Our story</p>
        <h1 className="aboutTitle">
          One app for the whole night out.
        </h1>
        <p className="aboutLede">
          After a hard day&rsquo;s work you want a cheap pint nearby, a couple of
          places, maybe to meet some people &mdash; without bouncing between
          Google Maps, other maps, and ChatGPT. One app. Great memories. That
          is the whole idea behind PUBMAXX.
        </p>
      </header>

      <section className="aboutSection" aria-labelledby="why">
        <h2 id="why" className="aboutH2">Why we built it</h2>
        <p className="aboutBody">
          Planning a night out had quietly become a chore. The good pint is on
          one app, the walking route on another, the &ldquo;is this place any
          good?&rdquo; on a third, and the price &mdash; the thing that actually
          decides where you go &mdash; is nowhere at all. So you open five tabs,
          give up, and end up at the same place as last time.
        </p>
        <p className="aboutBody">
          PUBMAXX collapses that into one map. It is{" "}
          <strong>price-aware</strong> &mdash; you can see what a pint actually
          costs before you set off. It is <strong>story-led</strong> &mdash;
          every pub carries the heritage that makes it worth the walk. And it is{" "}
          <strong>map-first</strong> &mdash; the map is the product, not another
          feed to scroll.
        </p>
      </section>

      <section className="aboutSection" aria-labelledby="ethos">
        <h2 id="ethos" className="aboutH2">What we stand for</h2>
        <ul className="aboutEthos">
          <li>
            <strong>Honest data, always.</strong> Every price and heritage claim
            shows where it came from &mdash; sourced, contributed, or passed
            down. We never invent a fact to fill a gap.
          </li>
          <li>
            <strong>Experience over quantity.</strong> A great night is measured
            by the life around the drink, never by how much you drank. Nothing
            in PUBMAXX rewards drinking more.
          </li>
          <li>
            <strong>Privacy-first.</strong> Your memories are yours. Nothing is
            public unless you deliberately share it, and browsing needs no
            account.
          </li>
          <li>
            <strong>No ads, no paywalls, ever.</strong> Playfully
            anti-capitalist, operationally pro-joy: a response to rising costs
            and samey routines, not another thing to sell you.
          </li>
        </ul>
      </section>

      {/* ── Traction / numbers (real, computed at build) ───────── */}
      <section className="aboutSection aboutTraction" aria-labelledby="traction">
        <h2 id="traction" className="aboutH2">By the numbers</h2>
        <p className="aboutBody aboutTractionIntro">
          Everything below is computed from the same public datasets the app
          runs on &mdash; no vanity metrics, no invented users.
        </p>
        <dl className="aboutStatGrid">
          {tractionStats(stats).map((stat) => (
            <div key={stat.label} className="aboutStat">
              <dt className="aboutStatValue">{stat.value}</dt>
              <dd className="aboutStatBody">
                <span className="aboutStatLabel">{stat.label}</span>
                <span className="aboutStatNote">{stat.note}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="aboutPriceLine">
          Across <strong>{fmtInt(stats.boroughsCovered)}</strong> London
          boroughs and neighbourhoods, the cheapest observed pint is{" "}
          <span className="aboutPriceStamp">{cheapest}</span>, the dearest{" "}
          <span className="aboutPriceStamp">{dearest}</span>, and the average
          sits at <span className="aboutPriceStamp">{average}</span>.
        </p>
      </section>

      {/* ── Press kit ──────────────────────────────────────────── */}
      <section className="aboutSection aboutPress" aria-labelledby="press">
        <h2 id="press" className="aboutH2">Press kit</h2>
        <dl className="aboutPressGrid">
          <div className="aboutPressRow">
            <dt>Name</dt>
            <dd>PUBMAXX (the product and movement; the app is PUBMAXXING)</dd>
          </div>
          <div className="aboutPressRow">
            <dt>One line</dt>
            <dd>
              A price-aware, story-led, map-first pub-crawl planner for the UK
              &mdash; real pint prices, cited heritage, and community Pint Drops.
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Contact</dt>
            <dd>
              <a href={`mailto:${CONTACT_EMAIL}`} className="aboutLink">
                {CONTACT_EMAIL}
              </a>
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Founder</dt>
            <dd>
              Karan Manoharan &mdash;{" "}
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
            <dt>Explore</dt>
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
      </section>

      <section className="aboutSection aboutCta" aria-labelledby="cta">
        <h2 id="cta" className="aboutH2">Come pubmaxxing</h2>
        <p className="aboutBody">
          Investors, press, and future Pubmaxxers welcome. Start on the map, or
          say hello.
        </p>
        <div className="aboutCtaRow">
          <Link href="/map" className="aboutBtn aboutBtnPrimary">
            Open the map
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="aboutBtn aboutBtnGhost">
            Get in touch
          </a>
        </div>
      </section>
    </main>
  );
}
