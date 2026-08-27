"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Coins,
  Compass,
  LocateFixed,
  MapPin,
  Receipt,
  Route,
  Smartphone,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import SignInButton from "@/components/auth/SignInButton";
import { PubPalMascot } from "@/components/pal/PubPalMascot";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import CityChooser from "@/components/city/CityChooser";
import MessagesLink from "@/components/nav/MessagesLink";
import NotificationBell from "@/components/nav/NotificationBell";
import ThemeToggle from "@/components/ThemeToggle";
// Shared nav atoms (bell/messages island) carry their styling in siteNav.css.
// The landing bar isn't the SiteNav component, but it now flies the same
// wordmark + action cluster, so it pulls in those shared styles directly.
import "@/components/nav/siteNav.css";
import type { AboutStats } from "@/lib/aboutStats";
import {
  preferredCityMapHref,
  readPreferredCity,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { warmMapRoute } from "@/lib/mapWarmup";
import { onReducedMotionChange, prefersReducedMotion } from "@/lib/motionVocabulary";
import { planOccasionHref } from "@/lib/planOccasion";
import { CONTACT_MAILTO } from "@/lib/siteContact";
import { trackEvent } from "@/lib/analytics";
import type { LandingCtaTarget } from "@/lib/analyticsEvents";

import PintDropStripLoading from "./PintDropStripLoading";
import ThamesHero from "./ThamesHero";
import "./landing.css";
import "./heroCinema.css";

function trackLandingCta(target: LandingCtaTarget) {
  trackEvent("landing_cta_clicked", { target });
}

const PintDropStrip = dynamic(() => import("./PintDropStrip"), {
  ssr: false,
  loading: PintDropStripLoading,
});

const PRODUCT_SIGNALS = [
  {
    icon: Coins,
    title: "Prices on record",
    body: "When a price record names a publisher, we name and link it. When no publisher is recorded, the price says so. The ones logged by drinkers carry the day they were seen.",
  },
  {
    icon: CalendarClock,
    title: "Right pub, right hour",
    body: "A quiet one at lunch, a cheap round after work, whatever's on late. It turns up when you need it, not all in a heap.",
  },
  {
    icon: Route,
    title: "One route, sorted",
    body: "The walk, the stops, the way home, all in one place. So you get to the pub instead of losing it between three apps.",
  },
] as const;

const HOW_IT_WORKS_STEPS = [
  { icon: MapPin, href: "/map", n: "01", title: "Map", body: "Find nearby pubs and check the source behind each price." },
  { icon: Route, href: "/plan", n: "02", title: "Plan", body: "Build a route and invite your crew." },
  { icon: Receipt, href: "/map?log=1", n: "03", title: "Pint Drop", body: "Log what you paid at the bar." },
  { icon: Compass, href: "/pal", n: "04", title: "Pub Pal", body: "Ask for a pub or Plan that fits tonight." },
] as const;

// Locale integer with grouping (2800 -> "2,800"). British thousands separators
// match the receipt-numeral voice used everywhere prices are shown.
function fmtInt(n: number): string {
  return n.toLocaleString("en-GB");
}

// Turn the honest, build-time coverage stats into the hero "live readout" — the
// small proof row under the CTAs. Only counts that survived the real dataset
// (> 0) become chips; a missing/zeroed figure is dropped rather than shown as a
// hollow "0 pubs". When nothing survives (a failed data read) the caller falls
// back to plain product copy so the hero never looks broken. Taste doctrine:
// no invented counts — every number here is derived in lib/aboutStats.
function heroReadout(
  stats: AboutStats | undefined,
): Array<{ icon: typeof MapPin; value: string; label: string }> {
  if (!stats) return [];
  const chips: Array<{ icon: typeof MapPin; value: string; label: string }> = [];
  if (stats.pubsTracked > 0) {
    chips.push({ icon: MapPin, value: fmtInt(stats.pubsTracked), label: "pubs tracked" });
  }
  if (stats.pintPricesObserved > 0) {
    // This count is the CURATED index's priced rows. Some legacy rows do not
    // name a publisher, and only community and first-party update rows carry a
    // genuine per-row date.
    chips.push({ icon: Receipt, value: fmtInt(stats.pintPricesObserved), label: "prices on record" });
  }
  if (stats.boroughsCovered > 0) {
    chips.push({ icon: Building2, value: fmtInt(stats.boroughsCovered), label: "London boroughs" });
  }
  return chips;
}

// Footer coverage facts — the same honest counts as the hero readout plus the
// UK-city reach. Guarded the same way: a zeroed figure is dropped, never shown.
function footerFacts(
  stats: AboutStats | undefined,
): Array<{ value: string; label: string }> {
  if (!stats) return [];
  const facts: Array<{ value: string; label: string }> = [];
  if (stats.pubsTracked > 0) facts.push({ value: fmtInt(stats.pubsTracked), label: "pubs tracked" });
  if (stats.pintPricesObserved > 0) facts.push({ value: fmtInt(stats.pintPricesObserved), label: "recorded prices" });
  if (stats.boroughsCovered > 0) facts.push({ value: fmtInt(stats.boroughsCovered), label: "London boroughs" });
  if (stats.citiesCovered > 0) facts.push({ value: fmtInt(stats.citiesCovered), label: "UK cities" });
  if (stats.historicPubsCited > 0) facts.push({ value: fmtInt(stats.historicPubsCited), label: "historic pubs cited" });
  return facts;
}

export default function LandingPage({
  stats,
  // Server-threaded friends-launch flag (default off = soft-launch preview).
  // Memory CTAs must not promise "Open Social" while the product is closed.
  socialFriendsLaunchEnabled = false,
}: {
  stats?: AboutStats;
  socialFriendsLaunchEnabled?: boolean;
}) {
  const router = useRouter();
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const mapHref = preferredCityMapHref();
  const primaryCtaHref = preferredCity ? mapHref : "/choose-city";
  const warmMap = useCallback(() => warmMapRoute(router, mapHref), [router, mapHref]);
  const warmProps = preferredCity
    ? {
        onPointerDown: warmMap,
        onPointerEnter: warmMap,
        onTouchStart: warmMap,
        onFocus: warmMap,
      }
    : {};

  const readout = heroReadout(stats);

  useEffect(() => {
    const hour = new Date().getHours();
    const daypart = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "night";
    trackEvent("discovery_viewed", { surface: "landing", daypart });
  }, []);

  // Hero scroll cinema (PIECE 2 of feat(landing): hero scroll cinema with
  // aperture splash). Drives --cinema-progress on .lpHero from scroll
  // position, 0 to 1 over CINEMA_SCROLL_DISTANCE px. Eligibility (viewport
  // width, prefers-reduced-motion) mirrors the compound media query in
  // heroCinema.css exactly. The CSS default is the settled, composed card
  // (progress 1) so no-JS and pre-JS readers get the finished hero; this
  // effect's first write at the top of the page (progress 0) is therefore a
  // deliberate state change that plays heroCinema.css's cinema-settle
  // transition as the open. Scroll-driven writes then set data-cinema-scrub
  // first, which turns those transitions off so the card tracks the wheel
  // 1:1. Reduced motion and phones (<=700px) never attach the listener; the
  // card stays the plain, static, settled treatment heroCinema.css falls
  // back to.
  const heroRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;

    const CINEMA_SCROLL_DISTANCE = 520;
    const wideQuery = window.matchMedia("(min-width: 701px)");
    let frame = 0;
    let listening = false;

    const applyProgress = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / CINEMA_SCROLL_DISTANCE));
      hero.style.setProperty("--cinema-progress", String(progress));
    };
    const onScroll = () => {
      if (frame) return;
      if (!hero.hasAttribute("data-cinema-scrub")) {
        hero.setAttribute("data-cinema-scrub", "");
      }
      frame = requestAnimationFrame(applyProgress);
    };
    const evaluate = () => {
      const eligible = wideQuery.matches && !prefersReducedMotion();
      if (eligible && !listening) {
        listening = true;
        applyProgress();
        window.addEventListener("scroll", onScroll, { passive: true });
      } else if (!eligible && listening) {
        listening = false;
        window.removeEventListener("scroll", onScroll);
        if (frame) cancelAnimationFrame(frame);
        hero.removeAttribute("data-cinema-scrub");
        hero.style.removeProperty("--cinema-progress");
      }
    };

    evaluate();
    const unsubscribeMotion = onReducedMotionChange(evaluate);
    wideQuery.addEventListener("change", evaluate);

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      wideQuery.removeEventListener("change", evaluate);
      unsubscribeMotion();
    };
  }, []);

  const heroPrimary = (
    <Link prefetch={false}
      className="lpButton lpButtonPrimary"
      href="/plan"
      onClick={() => trackLandingCta("plan")}
    >
      <UsersRound size={18} aria-hidden="true" /> Plan tonight together
    </Link>
  );
  const heroActions = (
    <div className="lpHeroActions">
      {heroPrimary}
      <div className="lpHeroSecondaryRow">
        <Link prefetch={false}
          className="lpTextLink"
          href={primaryCtaHref}
          {...warmProps}
          onClick={() => trackLandingCta("map")}
        >
          <MapPin size={17} aria-hidden="true" /> Open the map
        </Link>
        <Link prefetch={false} className="lpTextLink" href="/near?locate=1" onClick={() => trackLandingCta("near")}>
          <LocateFixed size={17} aria-hidden="true" /> Find my pint
        </Link>
      </div>
    </div>
  );
  const heroLede = (
    <p className="lpHeroLede">
      Open the map, pick a drink, and see which nearby pubs pour it cheapest.
      We name the source when there is one, and say when there is not.
    </p>
  );

  return (
    <div className="lp">
      <header className="lpNav">
        <Link prefetch={false} href="/" className="lpWordmark" aria-label="PUBMAXX home">
          <PubmaxxWordmark />
        </Link>

        <nav className="lpPrimaryNav" aria-label="Landing navigation">
          <Link prefetch={false} href="/map">Map</Link>
          <Link prefetch={false} href="/plan">Plan</Link>
          <Link prefetch={false} href="/tonight">Tonight</Link>
          <Link prefetch={false} href="/moment">Moment</Link>
          {socialFriendsLaunchEnabled ? (
            <Link prefetch={false} href="/social">Social</Link>
          ) : null}
          <Link prefetch={false} href="/u/you">You</Link>
        </nav>

        <div className="lpNavActions">
          {/* Canonical action island — same order/shape as SiteNav so the front
              door and the app read as one product. Bell/Messages are anon-safe
              (plain icon links, badge only when signed-in + unread). */}
          <NotificationBell />
          <MessagesLink />
          <ThemeToggle />
          <SignInButton compact />
        </div>
      </header>

      <main id="main">
        <section className="lpHero" aria-labelledby="hero-title" ref={heroRef}>
          <div className="lpHeroAtmosphere" aria-hidden="true">
            <span className="lpOrbit lpOrbitOne" />
            <span className="lpOrbit lpOrbitTwo" />
            <span className="lpScanline" />
          </div>

          <div className="lpHeroCopy">
            <h1 id="hero-title">London pints can cost eight quid.</h1>
            {heroActions}
            {heroLede}
            {readout.length > 0 ? (
              <dl className="lpLiveReadout" aria-label="What PUBMAXX tracks right now">
                {readout.map(({ icon: Icon, value, label }) => (
                  <div className="lpReadoutStat" key={label}>
                    <dt>
                      <Icon size={15} aria-hidden="true" /> {label}
                    </dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="lpLiveReadout" aria-label="Product highlights">
                <span><MapPin size={15} aria-hidden="true" /> Real prices, mapped</span>
                <span><Receipt size={15} aria-hidden="true" /> Source status shown</span>
              </div>
            )}
          </div>

          <figure className="lpHeroMap">
            <ThamesHero />
            <figcaption className="lpHeroMapCaption">
              <span className="lpHeroMapInvite">
                Each shape is a drink. Tap or pick one to see the pubs that pour it.
              </span>
            </figcaption>
          </figure>
        </section>

        {/* Human beat (S1/S4): why this exists, between hero and the feature
            grid. Desire first, honesty second. Not a mission statement.
            Outing jobs (coffee, food, quiet Spoons, soft drink / AF) sit here
            so the hero can stay map-first and pint-led. */}
        <section className="lpWhySection" id="why" aria-labelledby="why-title">
          <div className="lpWhyCopy">
            <p className="lpSectionLabel">Why PUBMAXX</p>
            <h2 id="why-title">Built for the bit before you set off.</h2>
            <p>
              You want somewhere that will not mug you on the first round. A
              cheap pint near the station. Coffee and a quiet Spoons when the
              afternoon is the outing. Food before the last train. Soft drink
              or alcohol-free with mates who are not drinking. One map should
              answer that without the usual three-app shuffle.
            </p>
            <p>
              Keeping those prices honest takes real work. We would rather
              leave a gap than invent a figure. The longer why is on Our story.
            </p>
            <div className="lpWhyActions">
              <Link prefetch={false} href={primaryCtaHref} className="lpTextLink" {...warmProps}>
                Open the map <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link prefetch={false} href="/plan" className="lpTextLink">
                Plan an outing <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link prefetch={false}
                href={planOccasionHref("coffee", { src: "landing-why" })}
                className="lpTextLink"
              >
                Coffee catch-up <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link prefetch={false}
                href={planOccasionHref("af", { src: "landing-why" })}
                className="lpTextLink"
              >
                Alcohol-free outing <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link prefetch={false}
                href={planOccasionHref("chill", { src: "landing-why" })}
                className="lpTextLink"
              >
                Chill afternoon <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link prefetch={false} href="/about" className="lpTextLink">
                Our story <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        <section className="lpSignalSection" id="wedge" aria-labelledby="signal-title">
          <div className="lpSectionIntro">
            <h2 id="signal-title">Listed pint prices near you</h2>
            <p>Start with the pint price. The hour and the route come with it.</p>
          </div>
          <div className="lpSignalGrid">
            {PRODUCT_SIGNALS.map(({ icon: Icon, title, body }, index) => (
              <article key={title}>
                <div className="lpSignalTopline">
                  <span>0{index + 1}</span>
                  <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lpMemorySection" aria-labelledby="memory-title">
          <div className="lpMemoryCanvas">
            <div className="lpMemoryCopy">
              <h2 id="memory-title">How PUBMAXX works</h2>
              <p>Find the pub, plan the route, log the pint, or ask for help.</p>
              <div className="lpMemoryActions">
                <Link prefetch={false} href="/plan" className="lpButton lpButtonPrimary">Start a plan</Link>
                {socialFriendsLaunchEnabled ? (
                  <Link prefetch={false} href="/social" className="lpTextLink">
                    Open Social <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                ) : (
                  <Link prefetch={false} href="/u/you#night-memories" className="lpTextLink">
                    Open Memories <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                )}
              </div>
            </div>
            <ol className="lpMemorySteps">
              {HOW_IT_WORKS_STEPS.map(({ icon: Icon, href, n, title, body }) => (
                <li key={n}>
                  <span className="lpStepIcon"><Icon size={19} strokeWidth={1.6} aria-hidden="true" /></span>
                  <div><span>{n}</span><h3><Link prefetch={false} href={href}>{title}</Link></h3><p>{body}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lpProofSection" id="drops" aria-labelledby="proof-title">
          <div className="lpSectionIntro lpProofIntro">
            <div>
              <p className="lpSectionLabel">Live product proof</p>
              <h2 id="proof-title">The map gets better when Pubmaxxers show up.</h2>
            </div>
            <p>Pint Drops keep the prices honest. Stories show what a place is actually like. And whatever you add always says where it came from.</p>
          </div>
          <PintDropStrip />
          <div className="lpPalCallout" id="landlord">
            <span className="lpPalIcon"><PubPalMascot size={48} circular lazy /></span>
            <div><h3>Ask your Pub Pal</h3><p>Tell it a mood, a budget, or half an idea, and it hands back a real plan. You confirm every change, always.</p></div>
            <Link prefetch={false} href="/pal/chat" className="lpTextLink">Ask your Pub Pal <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>

        <div id="cities" className="lpCityChooser">
          <CityChooser variant="section" />
        </div>

        <section className="lpFinalCta" aria-labelledby="final-title">
          <div className="lpFinalLines" aria-hidden="true"><span /><span /><span /></div>
          <p>PUBMAXX · Make a memory, not a spreadsheet</p>
          <h2 id="final-title">Your city is already happening.</h2>
          <Link prefetch={false}
            href="/plan"
            className="lpButton lpButtonPrimary"
            onClick={() => trackLandingCta("plan")}
          >
            Plan tonight together <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link prefetch={false}
            href={primaryCtaHref}
            className="lpTextLink"
            {...warmProps}
            onClick={() => trackLandingCta("map")}
          >
            Open the map <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link prefetch={false} href="/near?locate=1" className="lpTextLink" onClick={() => trackLandingCta("near")}>
            Find my pint <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>
      </main>

      <footer className="lpFooter">
        <div className="lpFooterInner">
          <div className="lpFooterBrand">
            <Link prefetch={false} href="/" className="lpWordmark" aria-label="PUBMAXX home">
              <PubmaxxWordmark />
            </Link>
            <p className="lpFooterPitch">
              A pint in London can cost eight quid and nobody tells you where it is
              cheaper. We show prices on record, get your mates in one place, and
              put you all on one route.
            </p>
            <p className="lpFooterMission">
              Built so the price of a pint stays fair, by people who go to the pub.
            </p>
            <p className="lpInstallNudge">
              <Smartphone size={15} aria-hidden="true" />
              Put PUBMAXX on your home screen and tonight is one tap away. We only
              ask once you have been back, never on your first pint. On iPhone, tap
              Share then Add to Home Screen.
            </p>
          </div>

          <nav className="lpFooterNav" aria-label="Footer">
            <div className="lpFooterCol">
              <h2>Get out tonight</h2>
              <Link prefetch={false} href="/map">The map</Link>
              {/* Bare /near: a footer directory tap is browsing, so it must not
                  fire the geolocation prompt. Only the two deliberate one-tap
                  CTAs above ask for a location on arrival. */}
              <Link prefetch={false} href="/near">Find my pint</Link>
              <Link prefetch={false} href="/tonight">Tonight</Link>
              <Link prefetch={false} href="/plan">Plan a night</Link>
            </div>
            <div className="lpFooterCol">
              <h2>The good stuff</h2>
              {socialFriendsLaunchEnabled ? (
                <Link prefetch={false} href="/social">Social</Link>
              ) : null}
              <Link prefetch={false} href="/pal">Pub Pal</Link>
              <Link prefetch={false} href="/choose-city">Pick your city</Link>
              <Link prefetch={false} href="/about">Our story</Link>
            </div>
          </nav>
        </div>

        <div className="lpFooterBase">
          <p className="lpFooterProvenance">
            When a price record names a publisher, we name and link it. When no
            publisher is recorded, the price says so. The ones drinkers log come
            with the day they were seen, and no pub can pay to rank higher.
          </p>
          {footerFacts(stats).length > 0 ? (
            <ul className="lpFooterFacts" aria-label="What we track">
              {footerFacts(stats).map(({ value, label }) => (
                <li key={label}>
                  <span className="lpFooterFactValue">{value}</span> {label}
                </li>
              ))}
            </ul>
          ) : null}
          {/* Small print rail: the two pages a reader is entitled to find from
              any page of the site, plus a contact address that actually works.
              Sits with the over-18 line because that is where legal copy lives. */}
          <nav className="lpFooterSmallPrint" aria-label="Small print">
            <Link prefetch={false} href="/privacy">Privacy</Link>
            <Link prefetch={false} href="/terms">Terms of use</Link>
            <a href={CONTACT_MAILTO}>Contact</a>
          </nav>
          <p className="lpFooterLegal">
            PUBMAXX is for over-18s. Know your limits, and know the facts at{" "}
            <a href="https://www.drinkaware.co.uk" rel="noreferrer">
              drinkaware.co.uk
            </a>
            . Prices change, so check at the bar.
          </p>
        </div>
      </footer>
    </div>
  );
}
