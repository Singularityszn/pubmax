import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { loadAboutStats, type AboutStats } from "@/lib/aboutStats";
import { CONTACT_EMAIL } from "@/lib/siteContact";

import "./about.css";

// /about — the founder story surface (PRD_SEARCH_GROWTH S4.5). One page that
// triples as: (1) the "why PUBMAXX exists" narrative, (2) a press bio + press
// kit, and (3) an investor link surface. Server component, zero client JS — it
// renders once from the bundled datasets and the site's design tokens.
//
// Provenance rule (CONTEXT.md / PRODUCT.md): every number in the traction band
// is computed at request time from the same data the map reads (lib/aboutStats)
// — no invented users, revenue, or growth metrics. The prose is the owner's own
// narrative in brand voice (docs/VOICE.md); there are no fabricated quotes.

const PAGE_TITLE = "Our story: why PUBMAXX exists";
const PAGE_DESCRIPTION =
  "A pint in London can cost eight quid, and nobody tells you where it doesn't. PUBMAXX puts real prices from real people on one map, with the whole night in a single plan. Free, and nobody pays to rank.";

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

type Stat = { value: string; label: string; note: string };

function tractionStats(s: AboutStats): Stat[] {
  return [
    {
      value: fmtInt(s.pubsTracked),
      label: "pubs tracked",
      note: "each one carrying a real, sourced price",
    },
    {
      value: fmtInt(s.pintPricesObserved),
      label: "pint prices logged",
      note: "readings from public data, every one sourced",
    },
    {
      value: fmtInt(s.historicPubsCited),
      label: "historic pubs cited",
      note: "one sourced fact each",
    },
    {
      value: fmtInt(s.citiesCovered),
      label: "UK cities live",
      note: "London first, more to browse",
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
        "Listed pint prices with named sources, mapped with cited pub heritage. A free pub-crawl planner for the UK that never lets anyone pay to rank.",
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
          A pint in London can cost eight quid. Nobody tells you where it doesn&rsquo;t.
        </h1>
        <p className="aboutLede">
          You finish work, you want a good pint nearby, maybe two, maybe
          somewhere your mates can actually find. So you open Google Maps, then
          another map, then reviews, then you&rsquo;re asking ChatGPT, and an
          hour later you&rsquo;re back at the same place as last time. We built
          PUBMAXX so you don&rsquo;t have to do that. One map. Real prices. The
          whole night in one place.
        </p>
      </header>

      <section className="aboutSection" aria-labelledby="why">
        <h2 id="why" className="aboutH2">Why we built it</h2>
        <p className="aboutBody">
          Planning a night out had quietly turned into admin. The cheap pint is
          on one app. The walk is on another. Whether the place is any good is
          on a third. And the price, the thing that actually decides where you
          go, is nowhere at all.
        </p>
        <p className="aboutBody">
          So most nights you don&rsquo;t plan. You give up and end up where you
          always end up. We got tired of that. A pint shouldn&rsquo;t cost a
          day&rsquo;s lunch, and finding the one that doesn&rsquo;t
          shouldn&rsquo;t cost your whole evening.
        </p>
      </section>

      <section className="aboutSection" aria-labelledby="did">
        <h2 id="did" className="aboutH2">What we did about it</h2>
        <p className="aboutBody">
          We put real prices on the map. Every one names where it came from,
          and the ones logged by drinkers carry the day they were seen. Tap a
          pub and you see what a pint costs before you set off, not after
          you&rsquo;ve handed over a note.
        </p>
        <p className="aboutBody">
          We kept the stories too. Most of these pubs have been pouring for a
          century or two, and the good ones earned their walk. So we cite the
          heritage, and we never make it up.
        </p>
        <p className="aboutBody">
          And we made it one link for the crew. You plan the night, you send it,
          everyone lands in the same place walking the same route. No group-chat
          archaeology at half six.
        </p>
        <p className="aboutBody">
          Nobody pays to rank. Not ever. There&rsquo;s a wall in the code between anyone&rsquo;s money
          and the prices you see. A sponsored thing says so and sits in its own
          slot. The order of pubs on your map is never for sale.
        </p>
      </section>

      <section className="aboutSection" aria-labelledby="who">
        <h2 id="who" className="aboutH2">Who it&rsquo;s for</h2>
        <p className="aboutBody">
          Everyone who actually goes to the pub. The after-work crowd who want a
          cheap round before the last train. The quiet-pint person who just
          wants a good one and a seat by the window. The birthday mob who need
          somewhere that&rsquo;ll take twelve of them on a Friday. We&rsquo;re
          building this for people who notice an eight-quid lager.
        </p>
      </section>

      <section className="aboutSection" aria-labelledby="ethos">
        <h2 id="ethos" className="aboutH2">What we stand for</h2>
        <ul className="aboutEthos">
          <li>
            <strong>Prices with named sources.</strong> Listed prices name their
            sources, and cited pub stories link to their references. If we
            can&rsquo;t stand a number up, we leave it blank. No filler, no
            guess dressed up as data.
          </li>
          <li>
            <strong>Good nights count people and memories.</strong> Rewards and
            rankings do not count how much you drink.
          </li>
          <li>
            <strong>Your nights are yours.</strong> Nothing&rsquo;s public unless
            you choose to share it, and you can browse the whole thing without an
            account.
          </li>
          <li>
            <strong>Free to browse.</strong> Nobody pays to rank, and sponsored
            items sit in their own labelled slots.
          </li>
        </ul>
      </section>

      {/* ── Traction / numbers (real, computed at build) ───────── */}
      <section className="aboutSection aboutTraction" aria-labelledby="traction">
        <h2 id="traction" className="aboutH2">By the numbers</h2>
        <p className="aboutBody aboutTractionIntro">
          Every number here is counted from the same public data the app runs
          on. No vanity metrics, no invented users. If it&rsquo;s on this page,
          it&rsquo;s real.
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
          boroughs and neighbourhoods, the cheapest pint we&rsquo;ve logged is{" "}
          <span className="aboutPriceStamp">{cheapest}</span>. The dearest is{" "}
          <span className="aboutPriceStamp">{dearest}</span>, and someone is
          paying it. The average sits at{" "}
          <span className="aboutPriceStamp">{average}</span>.
        </p>
      </section>

      {/* ── Press kit ──────────────────────────────────────────── */}
      <section className="aboutSection aboutPress" aria-labelledby="press">
        <h2 id="press" className="aboutH2">Press kit</h2>
        <dl className="aboutPressGrid">
          <div className="aboutPressRow">
            <dt>Name</dt>
            <dd>PUBMAXX. The app is PUBMAXXING.</dd>
          </div>
          <div className="aboutPressRow">
            <dt>One line</dt>
            <dd>
              Listed pint prices with named sources, one map, and the whole night in
              a single plan. Free, and nobody pays to rank.
            </dd>
          </div>
          <div className="aboutPressRow">
            <dt>Positioning</dt>
            <dd>London runs on its pubs. This is the app that runs your night.</dd>
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

      {/* ── Story hooks (press angle) ──────────────────────────── */}
      <section className="aboutSection aboutPress" aria-labelledby="press-hooks">
        <h2 id="press-hooks" className="aboutH2">Story hooks</h2>
        <p className="aboutBody">
          London runs on its pubs. This is the app that runs your night. If
          you&rsquo;re writing about the cost of a night out, the Pint Index is
          your angle.
        </p>
        <ul className="aboutEthos">
          <li>
            <strong>London&rsquo;s pint price league table.</strong> The Pint
            Index ranks{" "}
            <strong>{fmtInt(stats.boroughsCovered)}</strong> boroughs and
            neighbourhoods by the price of a pint, from{" "}
            <span className="aboutPriceStamp">{cheapest}</span> at the cheap end
            to <span className="aboutPriceStamp">{dearest}</span> at the top. It
            is built from{" "}
            <strong>{fmtInt(stats.pintPricesObserved)}</strong> sourced
            readings, and every figure links back to where it came from.
          </li>
          <li>
            <strong>A price series, not a one-off headline.</strong> The prices
            people log carry the day they were seen, so the Pint Index can show
            how a London pint moves over a season, not just what it costs today.
          </li>
          <li>
            <strong>Sourced, never invented.</strong> Where the data
            can&rsquo;t stand up an honest number for an area, the table shows
            nothing there. No filler, no estimate dressed up as a fact.
          </li>
        </ul>
        <p className="aboutBody">
          <Link href="/pint-index" className="aboutLink">
            See the league table
          </Link>
        </p>
      </section>

      <section className="aboutSection aboutCta" aria-labelledby="cta">
        <h2 id="cta" className="aboutH2">Come pubmaxxing</h2>
        <p className="aboutBody">
          Press, investors, and anyone who just wants a cheaper pint: you&rsquo;re
          all welcome. Start on the map, or say hello.
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
            >
              Open Government Licence v3.0
            </a>
            . Each listed fact links to its official list entry.
          </li>
          <li>Heritage narrative is cited from Wikipedia and Wikidata.</li>
          <li>Mapping data is &copy; OpenStreetMap contributors.</li>
        </ul>
      </section>
    </main>
  );
}
