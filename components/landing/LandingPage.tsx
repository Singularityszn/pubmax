"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  Beer,
  Coins,
  Trees,
  BookOpen,
  MessageSquareText,
  HandCoins,
  ArrowRight,
  MapPin,
} from "lucide-react";
import ThamesHero from "./ThamesHero";
import ThemeToggle from "@/components/ThemeToggle";
import SignInButton from "@/components/auth/SignInButton";
import PintDropStrip from "./PintDropStrip";
import "./landing.css";

// One IntersectionObserver reveals sections as they enter view. The hidden
// initial state is CSS-gated behind the .jsEnhanced class this effect adds to
// the root — so with JS disabled, before this effect runs, or in a full-page
// screenshot where off-screen sections never trip the observer, every .reveal
// section is fully visible. The reveal is a pure progressive enhancement.
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = root.querySelectorAll<HTMLElement>(".reveal");
    // Wire the observer up FIRST, then flip the root into the enhanced state,
    // so the hidden→animate CSS never applies to a section we can't reveal.
    if (!("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("isVisible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("isVisible");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
    );
    targets.forEach((el) => io.observe(el));
    root.classList.add("jsEnhanced");
    // Safety net: anything already in view (or that never trips the observer,
    // e.g. during a full-page screenshot) is revealed on the next frame so it
    // can never be captured as a blank band.
    const raf = requestAnimationFrame(() => {
      targets.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          el.classList.add("isVisible");
        }
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);
  return ref;
}

const wedge = [
  {
    icon: Coins,
    title: "Price",
    body: "Real observed pint prices, not guesses. Sort a night from the cheapest cellar in the borough to the ones worth paying for, and know the number before you order.",
    n: "01 — What it costs",
  },
  {
    icon: Trees,
    title: "Setting",
    body: "By the water, a garden that catches the sun, or the right room on a wet Tuesday. Filter for the pub that fits the evening you actually want.",
    n: "02 — Where it sits",
  },
  {
    icon: BookOpen,
    title: "Story",
    body: "Listed buildings, coaching inns, the bar Dickens leaned on. Every pin carries the history on record — so a crawl reads like a walk through the city.",
    n: "03 — Who came before",
  },
];

const drops = [
  {
    who: "@meridian_w4",
    price: "£4.10",
    note: "Cask Landlord, poured properly. My grandad drank here after his shifts at the brewery — same corner table, still the cheapest in Chiswick.",
    when: "Added 2 days ago · Chiswick",
  },
  {
    who: "@olly.se16",
    price: "£5.40",
    note: "Pricey, but you drink it on the jetty watching the tide turn. Worth it once. Bring someone you like.",
    when: "Added last week · Rotherhithe",
  },
];

const goldenDays = [
  {
    kicker: "£1.80 a pint",
    title: "Cheap pints, long tabs",
    body: "When the round came to less than the bus fare home and you stayed until they turned the lights up. The pub was the cheapest good night in the city — and half of us were only there because we couldn't afford anywhere else.",
  },
  {
    kicker: "Last orders, never",
    title: "Chaotic nights, worth it",
    body: "The wrong turn that found the right pub. The lock-in you shouldn't have stayed for. The crawl that started as three of you and finished as fifteen, none of you sure whose idea the last one was.",
  },
  {
    kicker: "The back-room table",
    title: "Where everything collided",
    body: "Art students arguing with historians, someone sketching a startup on a beer mat, old regulars who'd fixed the world a thousand times over. Friendship, history, coding and drinking, all at one sticky table. Those pubs made people.",
  },
];

export default function LandingPage() {
  const ref = useReveal();

  return (
    <div className="lp" ref={ref}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="container topbarInner">
          <Link href="/" className="wordmark" aria-label="PUBMAXXING home">
            <span className="brandGlyph" aria-hidden="true">
              <Beer size={20} strokeWidth={1.5} />
            </span>
            <span className="wordmarkText">PUBMAXXING</span>
          </Link>
          <nav className="navLinks" aria-label="Primary">
            <a href="#wedge">How it works</a>
            <a href="#landlord">The PUBMAXXER</a>
            <a href="#drops">Pint Drops</a>
            <Link href="/feed">Feed</Link>
            <Link href="/crawls">Crawls</Link>
            <Link href="/admin">Admin</Link>
            <ThemeToggle />
            <SignInButton />
            <Link href="/map" className="btn btnPrimary topbarCta">
              Open the map
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="hero container" aria-labelledby="hero-title">
          <div className="heroGrid">
            <div className="heroCopy">
              <p className="eyebrow">Every pint has a story.</p>
              <h1 id="hero-title" className="lpSerif">
                Bring back <em>pub crawling.</em>
              </h1>
              <p className="heroTagline lpSerif">
                Cheap pints, chaotic nights, and the crawl stories worth passing
                down.
              </p>
              <p className="heroLede">
                PUBMAXXING maps every real pint price and every pub worth the
                walk across London — so the night plans itself and the wandering
                is the point.
              </p>
              <div className="heroActions">
                <Link href="/map" className="btn btnPrimary">
                  Open the map
                  <ArrowRight size={18} strokeWidth={1.5} aria-hidden="true" />
                </Link>
                <Link href="/map?style=heritage" className="btn btnGhost">
                  Start with heritage
                </Link>
                <a href="#wedge" className="btn btnGhost">
                  How it works
                </a>
              </div>
              <ul className="statChips" aria-label="At a glance">
                <li className="statChip">
                  <strong>3,000+</strong>
                  <span>pint prices mapped</span>
                </li>
                <li className="statChip">
                  <strong>Every borough</strong>
                  <span>across London</span>
                </li>
                <li className="statChip">
                  <strong>from £1.99</strong>
                  <span>cheapest observed</span>
                </li>
              </ul>
            </div>
            <figure className="heroFigure">
              <ThamesHero />
              <figcaption className="figCaption">
                A crawl along the river — four pins, four prices, one afternoon.
                Figures shown are illustrative.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ── The wedge ─────────────────────────────────────────── */}
        <section id="wedge" className="container" aria-labelledby="wedge-title">
          <div className="sectionHead reveal">
            <p className="eyebrow">The wedge</p>
            <h2 id="wedge-title" className="lpSerif">
              Three questions every good pub answers.
            </h2>
            <p>
              A listings site tells you a pub exists. PUBMAXXING tells you what
              it costs, what it feels like, and why it has stood there for two
              hundred years.
            </p>
          </div>
          <div className="cardGrid">
            {wedge.map(({ icon: Icon, title, body, n }) => (
              <article className="wedgeCard reveal" key={title}>
                <span className="wedgeIcon" aria-hidden="true">
                  <Icon size={22} strokeWidth={1.5} />
                </span>
                <h3 className="lpSerif">{title}</h3>
                <p>{body}</p>
                <span className="wedgeNumber">{n}</span>
              </article>
            ))}
          </div>
        </section>

        {/* ── The Landlord ──────────────────────────────────────── */}
        <section
          id="landlord"
          className="landlordSection"
          aria-labelledby="landlord-title"
        >
          <div className="container splitGrid">
            <div className="reveal">
              <p className="eyebrow">The PUBMAXXER</p>
              <h2 id="landlord-title" className="lpSerif sectionHeadTitle">
                Tap a pub. Ask its story.
              </h2>
              <p className="heroLede">
                The PUBMAXXER is a grounded guide, not a fabulist. It only tells
                you what is on the record — the listing, the archive, the price
                someone added last week — and it says so plainly when the record
                runs out.
              </p>
              <p style={{ color: "var(--ink-soft)", lineHeight: 1.6, margin: 0 }}>
                No invented anecdotes, no confident guesses. Every claim carries
                a source you can follow.
              </p>
            </div>

            <div className="chatMock reveal" aria-hidden="false">
              <div className="chatBar">
                <MessageSquareText size={17} strokeWidth={1.5} aria-hidden="true" />
                The PUBMAXXER — Ye Olde Cheshire Cheese
                <span className="exampleTag">Example</span>
              </div>
              <div className="chatBody">
                <p className="chatQuestion">Who used to drink here?</p>
                <div className="chatAnswer">
                  <p>
                    Rebuilt in 1667 after the Great Fire, it is a Grade II listed
                    tavern on Fleet Street. Dr Johnson lodged nearby and the pub
                    has long claimed Dickens among its regulars.
                  </p>
                  <p className="clarify">
                    The Dickens link is a house tradition rather than a documented
                    fact — I would not state it as certain.
                  </p>
                  <div className="sourceChips">
                    <span className="sourceChip">Historic England listing</span>
                    <span className="sourceChip">Pub heritage record</span>
                    <span className="sourceChip">Pint Drop · @fleetst_ale</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Pint Drops ────────────────────────────────────────── */}
        <section id="drops" className="container" aria-labelledby="drops-title">
          <div className="dropsGrid">
            <div className="dropStack reveal">
              {drops.map((d) => (
                <article className="dropSample" key={d.who}>
                  <div className="dropTop">
                    <span className="dropWho">{d.who}</span>
                    <span className="dropPrice">{d.price}</span>
                  </div>
                  <p>{d.note}</p>
                  <div className="dropMeta">
                    <small>{d.when}</small>
                    <span className="exampleTag">Example</span>
                  </div>
                </article>
              ))}
            </div>
            <div className="dropsCopy reveal">
              <p className="eyebrow">
                <HandCoins size={15} strokeWidth={1.5} aria-hidden="true" />
                Pint Drops
              </p>
              <h2 id="drops-title" className="lpSerif">
                The price you paid, and the note you pass down.
              </h2>
              <p className="heroLede">
                Log what your pint actually cost and leave a line worth keeping —
                the corner your dad favoured, the garden that ruins you for other
                gardens. Prices keep the map honest; the notes keep it human.
              </p>
              <p style={{ color: "var(--ink-soft)", lineHeight: 1.6, margin: 0 }}>
                One generation hands its pub knowledge to the next, one drop at a
                time.
              </p>
            </div>
          </div>

          {/* Live community feed: newest visible Pint Drops. Fails silently to
              nothing — never a blank/broken band. */}
          <div className="reveal">
            <PintDropStrip />
          </div>
        </section>

        {/* ── Golden days: editorial nostalgia ──────────────────── */}
        <section
          className="goldenSection container"
          aria-labelledby="golden-title"
        >
          <div className="sectionHead reveal">
            <p className="eyebrow">The golden days</p>
            <h2 id="golden-title" className="lpSerif">
              For the nights you half-remember, and the pubs you never forgot.
            </h2>
            <p>
              Before the apps and the algorithms, a good pub was a whole
              education — the one room where art, history, coding, friendship and
              drinking collided and nobody wanted to leave.
            </p>
          </div>
          <div className="goldenGrid">
            {goldenDays.map((g) => (
              <article className="goldenCard reveal" key={g.title}>
                <span className="goldenKicker">{g.kicker}</span>
                <h3 className="lpSerif">{g.title}</h3>
                <p>{g.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Generational unity ────────────────────────────────── */}
        <section className="unitySection" aria-labelledby="unity-title">
          <div className="container unityInner reveal">
            <p className="eyebrow" style={{ justifyContent: "center" }}>
              Why it matters
            </p>
            <blockquote id="unity-title" className="lpSerif">
              London loses a pub roughly every week. The map is how we
              <em> keep the table set.</em>
            </blockquote>
            <p>
              The good pub was always the one room where the eighteen-year-old on
              their first legal pint and the regular on their forty-thousandth
              ended up at the same bar. PUBMAXXING is built to bring them back to
              it — Gen Z, Gen X, and everyone between — to the same tables, the
              same stories, the same round.
            </p>
            <div className="genRow" aria-hidden="true">
              <span>First legal pint</span>
              <span>The Friday regulars</span>
              <span>The forty-year local</span>
            </div>
          </div>
        </section>

        {/* ── Final CTA band ────────────────────────────────────── */}
        <section className="ctaBand container" aria-labelledby="cta-title">
          <div className="ctaInner reveal">
            <h2 id="cta-title" className="lpSerif">
              Pick a borough. Plan the walk.
            </h2>
            <p>
              Open the map, set your price, and let the river do the routing.
              Every pin is a pint worth knowing about.
            </p>
            <Link href="/map" className="btn btnPrimary">
              Open the map
              <ArrowRight size={18} strokeWidth={1.5} aria-hidden="true" />
            </Link>
            <Link href="/map?style=heritage" className="btn btnGhost">
              Start with heritage
            </Link>
          </div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="footer">
        <div className="container footerGrid">
          <div>
            <Link href="/" className="wordmark" aria-label="PUBMAXXING home">
              <span className="brandGlyph" aria-hidden="true">
                <Beer size={18} strokeWidth={1.5} />
              </span>
              <span className="wordmarkText lpSerif">PUBMAXXING</span>
            </Link>
            <p className="footerMeta">
              A price-aware, story-led London pub-crawl planner. Pint prices are
              sourced from public data and community Pint Drops. Heritage notes
              draw on a pub-writing tradition carried by{" "}
              <a
                href="https://twitter.com/London_W4"
                target="_blank"
                rel="noreferrer"
              >
                Alastair Hilton (@London_W4)
              </a>
              .
            </p>
          </div>
          <div className="footerCols">
            <div className="footerCol">
              <h4>Explore</h4>
              <Link href="/map">
                <MapPin
                  size={13}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  style={{ verticalAlign: "-2px", marginRight: 5 }}
                />
                The map
              </Link>
              <Link href="/admin">Moderation</Link>
              <a href="#wedge">How it works</a>
              <a href="#drops">Pint Drops</a>
            </div>
            <div className="footerCol">
              <h4>The record</h4>
              <span>Prices from public data</span>
              <span>Heritage from listed records</span>
              <span>Notes from the community</span>
            </div>
          </div>
        </div>
        <div className="container footerColophon">
          <span>Built by Karan Manoharan</span>
          <span className="footerSocials">
            <a
              href="https://x.com/karansznx"
              target="_blank"
              rel="noreferrer"
              aria-label="Karan Manoharan on X"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href="https://github.com/karanmrn"
              target="_blank"
              rel="noreferrer"
              aria-label="Karan Manoharan on GitHub"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
            </a>
            <a
              href="https://www.linkedin.com/in/karanmanoharan23/"
              target="_blank"
              rel="noreferrer"
              aria-label="Karan Manoharan on LinkedIn"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
              </svg>
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
