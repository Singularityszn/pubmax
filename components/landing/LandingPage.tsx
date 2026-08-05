"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Camera,
  Coins,
  Compass,
  LocateFixed,
  MapPin,
  MessageSquareText,
  Receipt,
  Route,
  Smartphone,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import SignInButton from "@/components/auth/SignInButton";
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
import { CONTACT_MAILTO } from "@/lib/siteContact";
import { trackEvent } from "@/lib/analytics";

import PintDropStripLoading from "./PintDropStripLoading";
import ThamesHero from "./ThamesHero";
import "./landing.css";

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

const MEMORY_STEPS = [
  { icon: Compass, n: "01", title: "See what's on nearby", body: "Start with a mood, a price, or something happening round the corner." },
  { icon: UsersRound, n: "02", title: "Get the crew in", body: "Turn a saved pub into a night your mates can join and shape with you." },
  { icon: Camera, n: "03", title: "Keep the good bits", body: "Snap the night privately, then share only what everyone signs off." },
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
  // Server-threaded trusted-handoff flag (default off = current hierarchy).
  landingFindMyPint = false,
}: {
  stats?: AboutStats;
  landingFindMyPint?: boolean;
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

  const heroPrimary = (
    <Link className="lpButton lpButtonPrimary" href="/near">
      <LocateFixed size={18} aria-hidden="true" /> Find my pint
    </Link>
  );
  const heroActions = landingFindMyPint ? (
    <div className="lpHeroActions lpHeroActions--findMyPint">
      {heroPrimary}
      <div className="lpHeroSecondaryRow">
        <Link className="lpTextLink" href={primaryCtaHref} {...warmProps}>
          <MapPin size={17} aria-hidden="true" /> Open the map
        </Link>
        <Link className="lpTextLink" href="/plan">
          <MessageSquareText size={17} aria-hidden="true" /> Plan my night
        </Link>
      </div>
    </div>
  ) : (
    <div className="lpHeroActions">
      {heroPrimary}
      <Link className="lpButton lpButtonQuiet" href={primaryCtaHref} {...warmProps}>
        <MapPin size={17} aria-hidden="true" /> Open the map
      </Link>
      <Link className="lpButton lpButtonQuiet" href="/plan">
        <MessageSquareText size={17} aria-hidden="true" /> Plan my night
      </Link>
    </div>
  );
  const heroLede = (
    <p className="lpHeroLede">
      Price records show their publisher when one is recorded and say when none
      is. Pick your drink and see which nearby pubs pour it cheapest.
    </p>
  );

  return (
    <div className={landingFindMyPint ? "lp lp--findMyPint" : "lp"}>
      <header className="lpNav">
        <Link href="/" className="lpWordmark" aria-label="PUBMAXXING home">
          <PubmaxxWordmark />
        </Link>

        <nav className="lpPrimaryNav" aria-label="Landing navigation">
          <Link href={primaryCtaHref} {...warmProps}>Map</Link>
          <Link href="/tonight">Tonight</Link>
          <Link href="/moment">Moment</Link>
          <Link href="/social">Social</Link>
          <Link href="/u/you">You</Link>
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

      <main>
        <section className="lpHero" aria-labelledby="hero-title">
          <div className="lpHeroAtmosphere" aria-hidden="true">
            <span className="lpOrbit lpOrbitOne" />
            <span className="lpOrbit lpOrbitTwo" />
            <span className="lpScanline" />
          </div>

          <div className="lpHeroCopy">
            <h1 id="hero-title">Listed pint prices on an interactive map. Plan a crawl with your mates.</h1>
            {/* Flag off: lede then three equal-slot buttons (shipped).
                Flag on: actions immediately under the title so Find my pint
                owns the first screen; Map + Plan as secondary text. */}
            {landingFindMyPint ? (
              <>
                {heroActions}
                {heroLede}
              </>
            ) : (
              <>
                {heroLede}
                {heroActions}
              </>
            )}
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
            <figcaption>Each shape is a drink. Pick one to see the pubs that pour it.</figcaption>
          </figure>
        </section>

        <section className="lpSignalSection" id="wedge" aria-labelledby="signal-title">
          <div className="lpSectionIntro">
            <h2 id="signal-title">Listed pint prices near you</h2>
            <p>Three things decide where you go.</p>
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
              <p className="lpSectionLabel">From a pin to a story</p>
              <h2 id="memory-title">Plan the night. Keep the parts that mattered.</h2>
              <p>Your night stays private until you say otherwise. When the crew&rsquo;s ready, turn the moments everyone likes into a story worth keeping.</p>
              <div className="lpMemoryActions">
                <Link href="/plan" className="lpButton lpButtonPrimary">Start a plan</Link>
              <Link href="/social" className="lpTextLink">Open Social <ArrowRight size={16} aria-hidden="true" /></Link>
              </div>
            </div>
            <ol className="lpMemorySteps">
              {MEMORY_STEPS.map(({ icon: Icon, n, title, body }) => (
                <li key={n}>
                  <span className="lpStepIcon"><Icon size={19} strokeWidth={1.6} aria-hidden="true" /></span>
                  <div><span>{n}</span><h3>{title}</h3><p>{body}</p></div>
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
            <span className="lpPalIcon"><MessageSquareText size={23} aria-hidden="true" /></span>
            <div><h3>Ask your Pub Pal</h3><p>Tell it a mood, a budget, or half an idea, and it hands back a real plan. You confirm every change, always.</p></div>
            <Link href="/plan" className="lpTextLink">Plan my night <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>

        <div id="cities" className="lpCityChooser">
          <CityChooser variant="section" />
        </div>

        <section className="lpFinalCta" aria-labelledby="final-title">
          <div className="lpFinalLines" aria-hidden="true"><span /><span /><span /></div>
          <p>PUBMAXX · Make a memory, not a spreadsheet</p>
          <h2 id="final-title">Your city is already happening.</h2>
          {landingFindMyPint ? (
            <>
              <Link href="/near" className="lpButton lpButtonPrimary">
                Find my pint <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link href={primaryCtaHref} className="lpTextLink" {...warmProps}>
                Open the map <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </>
          ) : (
            <>
              <Link href={primaryCtaHref} className="lpButton lpButtonPrimary" {...warmProps}>
                Open the map <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link href="/about" className="lpTextLink">
                Our story <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </>
          )}
        </section>
      </main>

      <footer className="lpFooter">
        <div className="lpFooterInner">
          <div className="lpFooterBrand">
            <Link href="/" className="lpWordmark" aria-label="PUBMAXXING home">
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
              <Link href={primaryCtaHref} {...warmProps}>The map</Link>
              <Link href="/near">Find my pint</Link>
              <Link href="/tonight">Tonight</Link>
              <Link href="/plan">Plan a night</Link>
            </div>
            <div className="lpFooterCol">
              <h2>The good stuff</h2>
              <Link href="/social">Social</Link>
              <Link href="/pal">Pub Pal</Link>
              <Link href="/choose-city">Pick your city</Link>
              <Link href="/about">Our story</Link>
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
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms of use</Link>
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
