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
import "./landing.css";

// One IntersectionObserver reveals sections as they enter view. If JS never
// runs (SSR / no-JS), the .reveal elements are made visible by the reduced-
// motion CSS branch and by this effect adding .isVisible — content is never
// hidden behind JS. ponytail: plain observer, no animation lib needed.
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = root.querySelectorAll<HTMLElement>(".reveal");
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
    return () => io.disconnect();
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

export default function LandingPage() {
  const ref = useReveal();

  return (
    <div className="lp" ref={ref}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="container topbarInner">
          <Link href="/" className="wordmark" aria-label="PubMaxing home">
            <span className="brandGlyph" aria-hidden="true">
              <Beer size={20} strokeWidth={1.5} />
            </span>
            <span className="wordmarkText">PubMaxing</span>
          </Link>
          <nav className="navLinks" aria-label="Primary">
            <a href="#wedge">How it works</a>
            <a href="#landlord">The Landlord</a>
            <a href="#drops">Pint Drops</a>
            <Link href="/admin">Admin</Link>
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
              <p className="eyebrow">A London field guide</p>
              <h1 id="hero-title" className="lpSerif">
                Bring back <em>pub crawling.</em>
              </h1>
              <p className="heroLede">
                PubMaxing maps every real pint price and every pub worth the
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
              A listings site tells you a pub exists. PubMaxing tells you what it
              costs, what it feels like, and why it has stood there for two
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
              <p className="eyebrow">The Landlord</p>
              <h2 id="landlord-title" className="lpSerif sectionHeadTitle">
                Tap a pub. Ask its story.
              </h2>
              <p className="heroLede">
                The Landlord is a grounded guide, not a fabulist. It only tells
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
                The Landlord — Ye Olde Cheshire Cheese
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
              ended up at the same bar. PubMaxing is built to bring them back to
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
            <Link href="/" className="wordmark" aria-label="PubMaxing home">
              <span className="brandGlyph" aria-hidden="true">
                <Beer size={18} strokeWidth={1.5} />
              </span>
              <span className="wordmarkText lpSerif">PubMaxing</span>
            </Link>
            <p className="footerMeta">
              A price-aware, story-led London pub-crawl planner. Pint prices are
              sourced from public data and community Pint Drops. Heritage notes
              draw on a pub-writing tradition carried by{" "}
              <a
                href="https://twitter.com/London_W4"
                target="_blank"
                rel="noreferrer noopener"
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
      </footer>
    </div>
  );
}
