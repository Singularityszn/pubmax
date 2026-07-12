"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import CityChooser from "@/components/city/CityChooser";
import ThemeToggle from "@/components/ThemeToggle";
import SignInButton from "@/components/auth/SignInButton";
import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import { categoryColor } from "@/lib/categoryColors";
import {
  preferredCityMapHref,
  readPreferredCity,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import {
  categoryGradient,
  rotateCategory,
  wedgeCategory,
  type WedgeKey,
} from "@/lib/surfaceAccent";
import { warmMapRoute } from "@/lib/mapWarmup";
import "./landing.css";

function PintDropStripLoading() {
  return (
    <div className="dropStrip" aria-hidden="true">
      <div className="dropStripHead">
        <p className="eyebrow">
          <HandCoins size={15} strokeWidth={1.5} aria-hidden="true" />
          Fresh from the taps
        </p>
        <span className="dropStripHint">Newest community drops -&gt;</span>
      </div>
      <div className="dropStripRail">
        {Array.from({ length: 4 }).map((_, i) => (
          <div className="dropStripCard dropStripCardSkeleton" key={i}>
            <span className="skelLine skelLineTop" />
            <span className="skelLine" />
            <span className="skelLine" />
            <span className="skelLine skelLineShort" />
          </div>
        ))}
      </div>
    </div>
  );
}

const PintDropStrip = dynamic(() => import("./PintDropStrip"), {
  ssr: false,
  loading: PintDropStripLoading,
});

// One IntersectionObserver reveals sections as they enter view. The hidden
// initial state is CSS-gated behind the .jsEnhanced class this effect adds to
// the root — so with JS disabled, before this effect runs, or in a full-page
// screenshot where off-screen sections never trip the observer, every .reveal
// section is fully visible. The reveal is a pure progressive enhancement.
//
// `.jsEnhanced` is deliberately only added on the FIRST real `scroll` event,
// not on mount. A one-shot full-document capture (a headless screenshot tool,
// print, a share-image generator, or just a slow machine racing the observer)
// never fires a `scroll` event — `page.screenshot({ fullPage: true })` in
// particular captures beyond the viewport without ever scrolling the DOM. If
// `.jsEnhanced` were applied on mount, every `.reveal` section the
// IntersectionObserver hasn't gotten to yet (i.e. everything below the first
// viewport) would be captured mid-fade at `opacity: 0` — a permanent void,
// not a progressive-enhancement flourish. Gating on real scroll means a
// one-shot capture always renders identically to the no-JS baseline: fully
// visible.
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
    const revealInView = () => {
      targets.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          el.classList.add("isVisible");
        }
      });
    };
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
    let enhanced = false;
    const enableReveal = () => {
      if (enhanced) return;
      enhanced = true;
      // Mark anything already on screen visible FIRST, synchronously, so
      // flipping .jsEnhanced on can never flash currently-visible content to
      // hidden before its own IntersectionObserver entry fires.
      revealInView();
      root.classList.add("jsEnhanced");
      window.removeEventListener("scroll", enableReveal);
    };
    window.addEventListener("scroll", enableReveal, { passive: true, once: true });
    // Safety net: anything already in view on first paint still reveals
    // immediately once real scrolling starts (matches the previous mount-time
    // behaviour for above-the-fold sections).
    const raf = requestAnimationFrame(revealInView);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", enableReveal);
      io.disconnect();
    };
  }, []);
  return ref;
}

const wedge: {
  icon: typeof Coins;
  title: string;
  body: string;
  n: string;
  wedgeKey: WedgeKey;
}[] = [
  {
    icon: Coins,
    title: "Price",
    body: "Real observed pint prices, not guesses. Sort a night from the cheapest cellar in the borough to the ones worth paying for, and know the number before you order.",
    n: "01 — What it costs",
    wedgeKey: "price",
  },
  {
    icon: Trees,
    title: "Setting",
    body: "By the water, a garden that catches the sun, or the right room on a wet Tuesday. Filter for the pub that fits the evening you actually want.",
    n: "02 — Where it sits",
    wedgeKey: "setting",
  },
  {
    icon: BookOpen,
    title: "Story",
    body: "Listed buildings, coaching inns, taverns with centuries of paperwork behind them. Every pin carries what's actually on record — and says so when a claim is folklore, not fact.",
    n: "03 — Who came before",
    wedgeKey: "story",
  },
];

const drops = [
  {
    id: "chiswick-grandad-cask-landlord",
    who: "@meridian_w4",
    price: "£4.10",
    note: "Cask Landlord, poured properly. My grandad drank here after his shifts at the brewery - same corner table, still the cheapest in Chiswick.",
    when: "Added 2 days ago · Chiswick",
  },
  {
    id: "rotherhithe-jetty-tide",
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
  const router = useRouter();
  // Preference may be null → /choose-city. useSyncExternalStore keeps SSR on
  // /choose-city, then re-reads after mount (and on CityChooser writes).
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const hasPreferredCity = preferredCity != null;
  const mapHref = preferredCityMapHref();
  const primaryCtaHref = hasPreferredCity ? mapHref : "/choose-city";
  // Wave C2 (#204): one clear primary CTA regardless of city state. It does
  // not request geolocation and never claims to — it opens the preferred
  // city's map directly, or /choose-city first when there's no preference
  // yet. "Find pubs near me" implied an automatic location lookup that never
  // happens here, so the label says exactly what the click does instead.
  const primaryCtaLabel = "Open the map";
  // Wave K2 — mirror the tab bar: prefetch /map + slim payloads on intent
  // (pointerDown fires before navigation on phones; enter/focus cover desktop).
  const warmMap = useCallback(() => warmMapRoute(router, mapHref), [router, mapHref]);
  const mapWarmProps = {
    onPointerDown: warmMap,
    onPointerEnter: warmMap,
    onTouchStart: warmMap,
    onFocus: warmMap,
  };

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
            <Link href={primaryCtaHref} {...(hasPreferredCity ? mapWarmProps : {})}>
              Map
            </Link>
            <a href="#drops">Pint Drops</a>
            <Link href="/feed">Feed</Link>
            <Link href="/crawls">Crawls</Link>
            <ThemeToggle />
            {/* Compact host: one "Sign in" disclosure instead of two full
                provider buttons, so the sticky top bar never overflows at
                390px (auth.css shows the inline pair again at ≥1680px). */}
            <SignInButton compact />
            <Link
              href={primaryCtaHref}
              className="btn btnPrimary topbarCta"
              {...(hasPreferredCity ? mapWarmProps : {})}
            >
              {primaryCtaLabel}
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* ── Hero: brand-first full-bleed photo + drink-shaped pubs ── */}
        <section className="hero heroPhoto" aria-labelledby="hero-brand">
          <div className="container heroGrid">
            <div className="heroCopy">
              <h1 id="hero-brand" className="heroBrand lpSerif">
                PUBMAXXING
              </h1>
              <p className="heroTagline lpSerif">
                Know the price before you order…
              </p>
              <p className="heroLede">
                Real pint prices, drink-shaped pins, and what&apos;s actually
                on tonight — tap a glass to start.
              </p>
              <div className="heroActions">
                <Link
                  href={primaryCtaHref}
                  className="btn btnPrimary"
                  {...(hasPreferredCity ? mapWarmProps : {})}
                >
                  {primaryCtaLabel}
                  <ArrowRight size={18} strokeWidth={1.5} aria-hidden="true" />
                </Link>
                <a href="#wedge" className="btn btnGhost">
                  How it works
                </a>
              </div>
            </div>
            <figure className="heroFigure">
              <ThamesHero />
              <figcaption className="figCaption">
                Each shape is a drink family — beer, gin, whisky, wine, cocktail,
                rum. Prices are illustrative; tap to open the live map.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ── City chooser (interaction section; not a card dashboard) ── */}
        <div id="cities" className="reveal">
          <CityChooser variant="section" />
        </div>

        {/* ── The wedge ─────────────────────────────────────────── */}
        <section id="wedge" className="container" aria-labelledby="wedge-title">
          <div
            className="sectionHead reveal"
            data-cat="setting"
            style={{ ["--lp-cat" as string]: categoryColor(wedgeCategory("setting")) }}
          >
            <p className="eyebrow">The wedge</p>
            <h2 id="wedge-title" className="lpSerif">
              Three questions every good pub answers.
            </h2>
            <p>
              A listings site tells you a pub exists. PUBMAXXING tells you what
              it costs, what it feels like, and — where the record survives —
              how long it&apos;s actually been standing there.
            </p>
          </div>
          <div className="cardGrid">
            {wedge.map(({ icon: Icon, title, body, n, wedgeKey }) => {
              const cat = wedgeCategory(wedgeKey);
              return (
                <article
                  className="wedgeCard reveal"
                  key={title}
                  data-cat={cat}
                  style={{ ["--lp-cat" as string]: categoryColor(cat) }}
                >
                  <span className="wedgeIcon" aria-hidden="true">
                    <Icon size={22} strokeWidth={1.5} />
                  </span>
                  <div className="wedgeHeadRow">
                    <h3 className="lpSerif">{title}</h3>
                    {/* Redundant category cue: the glyph carries the drink
                        family alongside the colour, never colour alone. */}
                    <span className="wedgeGlyph">
                      <DrinkGlyph category={cat} size={22} />
                    </span>
                  </div>
                  <p>{body}</p>
                  <span className="wedgeNumber">{n}</span>
                </article>
              );
            })}
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
                <span className="exampleTag">Demo</span>
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
            <ol className="dropTimeline reveal" aria-label="Sample Pint Drops">
              {drops.map((d, i) => (
                <li className="dropTimelineItem" key={d.id}>
                  {i > 0 ? (
                    <div className="dropTimelineConnector" aria-hidden="true">
                      <span className="dropTimelineLine" />
                      <span className="dropTimelineArrow" />
                    </div>
                  ) : null}
                  <article className="dropSample">
                    <div className="dropTop">
                      <span className="dropWho">{d.who}</span>
                      <span className="dropPrice">{d.price}</span>
                    </div>
                    <p className="dropNote">{d.note}</p>
                    <div className="dropMeta">
                      <small>{d.when}</small>
                      <span className="exampleTag">Sample</span>
                    </div>
                  </article>
                </li>
              ))}
            </ol>
            <div className="dropsCopy reveal">
              <p className="eyebrow">
                <HandCoins size={15} strokeWidth={1.5} aria-hidden="true" />
                Pint Drops
              </p>
              <h2 id="drops-title" className="lpSerif">
                The price you paid, and the note you pass down.
              </h2>
              <p className="heroLede">
                Log what your pint actually cost and leave a line worth keeping -
                the corner your dad favoured, the garden that ruins you for other
                gardens. Prices keep the map honest; the notes keep it human.
              </p>
              <p className="dropsHanddown">
                One generation hands its pub knowledge to the next, one drop at a
                time.
              </p>
              <Link
                href={hasPreferredCity ? preferredCityMapHref(new URLSearchParams({ log: "1" })) : "/choose-city"}
                className="dropsCta"
                {...(hasPreferredCity ? mapWarmProps : {})}
              >
                Leave a Pint Drop
                <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" />
              </Link>
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
          <div
            className="sectionHead reveal"
            data-cat="cocktail"
            style={{ ["--lp-cat" as string]: categoryColor("cocktail") }}
          >
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
            {goldenDays.map((g, i) => {
              // Warm each nostalgia card with a different category from the
              // rotation — the "one loud place" for colour. Colour is pure
              // warmth here; the kicker + heading carry the meaning.
              const cat = rotateCategory(i + 2);
              return (
                <article
                  className="goldenCard reveal"
                  key={g.title}
                  data-cat={cat}
                  style={{
                    ["--lp-cat" as string]: categoryColor(cat),
                    background: categoryGradient(cat),
                  }}
                >
                  <span className="goldenKicker">{g.kicker}</span>
                  <h3 className="lpSerif">{g.title}</h3>
                  <p>{g.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        {/* ── Generational unity ────────────────────────────────── */}
        <section className="unitySection" aria-labelledby="unity-title">
          <div className="container unityInner reveal">
            <p className="eyebrow" style={{ justifyContent: "center" }}>
              Why it matters
            </p>
            <blockquote id="unity-title" className="lpSerif">
              London keeps losing pubs it can&apos;t get back. The map is how
              we<em> keep the table set.</em>
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
          <div className="ctaInner reveal textured-panel">
            <h2 id="cta-title" className="lpSerif">
              Pick a city. Plan the walk.
            </h2>
            <p>
              Open the map, set your price, and let the night do the routing.
              Every pin is a pint worth knowing about.
            </p>
            <Link
              href={primaryCtaHref}
              className="btn btnPrimary"
              {...(hasPreferredCity ? mapWarmProps : {})}
            >
              {primaryCtaLabel}
              <ArrowRight size={18} strokeWidth={1.5} aria-hidden="true" />
            </Link>
            <Link
              href={
                hasPreferredCity
                  ? preferredCityMapHref(new URLSearchParams({ style: "heritage" }))
                  : "/choose-city"
              }
              className="btn btnGhost"
              {...(hasPreferredCity ? mapWarmProps : {})}
            >
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
              <Link href={primaryCtaHref} {...(hasPreferredCity ? mapWarmProps : {})}>
                <MapPin
                  size={13}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  style={{ verticalAlign: "-2px", marginRight: 5 }}
                />
                The map
              </Link>
              <Link href="/choose-city">Choose your city</Link>
              <a href="#wedge">How it works</a>
              <a href="#drops">Pint Drops</a>
              <a href="#landlord">The PUBMAXXER</a>
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
