"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import DataCreditsLink from "@/components/legal/DataCreditsLink";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
// The landing bar isn't the SiteNav component, but it flies the same wordmark
// and renders SiteNav's OWN action cluster (SiteNavActions), so the front door
// and every app page offer one set of controls. SiteNav's module brings the
// shared styles with it.
import { SiteNavActions } from "@/components/nav/SiteNav";
import type { LandingAnswers } from "@/lib/landingAnswers";
import type { LandingArchiveIndex, LandingRailRow } from "@/lib/landingHero";
import type { LondonCollageAreaPrice } from "@/lib/landingLondonCollage";
import type { LandingPubCardData } from "@/lib/landingPubCard";
import { strangerSavingLine, type PintPriceAverages } from "@/lib/pintSavings";
import {
  preferredCityMapHref,
  readPreferredCity,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { useNowHref } from "@/lib/useNowHref";
import { PRIMARY_NAV_ITEMS, primaryNavLabel } from "@/components/nav/navigationModel";
import { warmMapRoute } from "@/lib/mapWarmup";
import { HELLO_MAILTO } from "@/lib/siteContact";
import { trackEvent } from "@/lib/analytics";
import type { LandingCtaTarget } from "@/lib/analyticsEvents";
import { socialSurfaceName } from "@/lib/socialLaunch";
import type { UkDirectoryCoverage } from "@/lib/ukDirectoryCoverage";
import { UK_NATIONAL_ENTRY_LABEL, UK_NATIONAL_MAP_HREF } from "@/lib/ukNationalBrowse";

import LandingAnswerCards from "./LandingAnswerCards";
import LandingFaq from "./LandingFaq";
import LandingHero from "./LandingHero";
import LandingLondonCollage from "./LandingLondonCollage";
import LandingLondonFilm from "./LandingLondonFilm";
import LandingSavings from "./LandingSavings";
import "./landing.css";

function trackLandingCta(target: LandingCtaTarget) {
  trackEvent("landing_cta_clicked", { target });
}

// The strip paints nothing while its own code loads: the feed may well be
// empty, and a grey band that only a later fetch can clear is a placeholder
// that ships for ever when the chunk or the feed never arrives.
const PintDropStrip = dynamic(() => import("./PintDropStrip"), {
  ssr: false,
  loading: () => null,
});

export default function LandingPage({
  card = null,
  archive = {},
  rail = [],
  averages = null,
  priceReadLine = null,
  collagePrices = {},
  answers = null,
  ukCoverage = null,
  // Server-threaded friends-launch flag. Explicit 0 is the rollback state.
  socialFriendsLaunchEnabled = true,
}: {
  /** The one real pub above the fold, or null when the data cannot back one. */
  card?: LandingPubCardData | null;
  /** The archive's then rows, keyed by venue id, built beside the card. */
  archive?: LandingArchiveIndex;
  /** The three next-cheapest rows under the anchor. */
  rail?: LandingRailRow[];
  /** The city's two mean pint prices, for the saving line (lib/pintSavings.ts). */
  averages?: PintPriceAverages | null;
  /** When the prices behind that average were read (lib/landingPubCard.server.ts). */
  priceReadLine?: string | null;
  /** Each photographed patch's cheapest nearby pint, for the founder collage. */
  collagePrices?: Record<string, LondonCollageAreaPrice>;
  /** What is on today and what is on tonight, one sentence each. */
  answers?: LandingAnswers | null;
  /** UK directory listings, never the denominator of a price comparison. */
  ukCoverage?: UkDirectoryCoverage | null;
  socialFriendsLaunchEnabled?: boolean;
}) {
  const router = useRouter();
  const citySaving = strangerSavingLine(averages);
  const nowHref = useNowHref();
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const mapHref = preferredCityMapHref();
  const mapCtaHref = preferredCity ? mapHref : "/map";
  const warmMap = useCallback(() => warmMapRoute(router, mapHref), [router, mapHref]);
  const warmProps = preferredCity
    ? {
        onPointerDown: warmMap,
        onPointerEnter: warmMap,
        onTouchStart: warmMap,
        onFocus: warmMap,
      }
    : {};

  const socialLabel = socialSurfaceName(socialFriendsLaunchEnabled);

  useEffect(() => {
    const hour = new Date().getHours();
    const daypart = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "night";
    trackEvent("discovery_viewed", { surface: "landing", daypart });
  }, []);

  return (
    <div className="lp">
      <header className="lpNav">
        <Link prefetch={false} href="/" className="lpWordmark" aria-label="PUBMAXX home">
          <PubmaxxWordmark />
        </Link>

        {/* The app's own primary destinations (PRIMARY_NAV_ITEMS), so the
            front door and every app page name the product the same way, Social
            by its launch state. Moment is not a front door and is not in that
            list. */}
        <nav className="lpPrimaryNav" aria-label="Landing navigation">
          {PRIMARY_NAV_ITEMS.map((item) =>
            item.key === "map" ? (
              <Link key={item.key} prefetch={false} href={mapCtaHref} {...warmProps}>
                {item.label}
              </Link>
            ) : (
              <Link key={item.key} prefetch={false} href={item.key === "now" ? nowHref : item.href}>
                {primaryNavLabel(item, socialLabel)}
              </Link>
            ),
          )}
        </nav>

        {/* The canonical action island itself, not a copy of it: More, compose,
            the palette hint, the signed-in bell and messages, and sign-in. */}
        <SiteNavActions className="siteNavActions lpNavActions" />
        {/* Paint the header only after its complete action subtree is parsed. */}
        <span hidden data-lp-nav-complete="" />
      </header>

      <main id="main">
        {/* The whole first screen, at every width: the claim, the saving line
            under it, the picture of London, one primary action (Cheapest pints
            near me), the quiet row of the receipt door and Tonight, then the
            one real pub and three next-cheapest rows. The DOM order is the
            phone order; the desktop only seats the picture and the rows beside
            the copy. */}
        <LandingHero card={card} archive={archive} rail={rail} />

        {/* The founder's own photographs of London, each patch with the
            cheapest listed pint a short walk from where it was taken. Straight
            after the answer, so the second thing a visitor sees is the city
            the prices come from (captain 18 Oct 2026). */}
        <LandingLondonCollage areaPrices={collagePrices} />

        {answers ? <LandingAnswerCards answers={answers} /> : null}

        {/* Keep the calculation and the dates behind it together. */}
        <section className="lpWorth" aria-label="What it saves you">
          {ukCoverage ? (
            <p className="lpSavingSummary" data-uk-coverage="">
              {ukCoverage.pubListings.toLocaleString("en-GB")} UK pub listings and{" "}
              {ukCoverage.barListings.toLocaleString("en-GB")} bar listings from OpenStreetMap.
              {" "}A listing doesn&apos;t mean we have its prices or know it&apos;s open.
            </p>
          ) : null}
          <Link prefetch={false} href={UK_NATIONAL_MAP_HREF} className="lpTextLink">
            {UK_NATIONAL_ENTRY_LABEL}
          </Link>
          {/* When the prices behind the hero's average were read (site review,
              18 Oct 2026: "Freshness is quiet"). It sits here and not in the
              hero, because at 320px a third lede line put the primary under
              the tab bar (e2e/landing-find-my-pint.spec.ts). */}
          {citySaving ? <p className="lpSavingSummary">{citySaving}</p> : null}
          {citySaving && priceReadLine ? <p className="lpPriceReads">{priceReadLine}</p> : null}
          <LandingSavings averages={averages} />
          <Link
            prefetch={false}
            href={mapCtaHref}
            className="lpTextLink"
            {...warmProps}
            onClick={() => trackLandingCta("map")}
          >
            Open the map
          </Link>
        </section>

        <div className="lpDrops">
          <PintDropStrip />
        </div>

        <LandingFaq />
        <LandingLondonFilm />
      </main>

      <footer className="lpFooter">
        <div className="lpFooterInner">
          <div className="lpFooterBrand">
            <Link prefetch={false} href="/" className="lpWordmark" aria-label="PUBMAXX home">
              <PubmaxxWordmark />
            </Link>
            <p className="lpFooterProvenance">
              Free to use. No pub can pay to rank higher.
            </p>
          </div>

          <nav className="lpFooterNav" aria-label="Footer">
            <div className="lpFooterCol">
              <h2>Get out tonight</h2>
              <Link prefetch={false} href={mapCtaHref} {...warmProps}>The map</Link>
              {/* Bare /near: a footer directory tap is browsing, so it must not
                  fire the geolocation prompt. Only the deliberate one-tap door
                  above asks for a location on arrival. */}
              <Link prefetch={false} href="/near">Find my pint</Link>
              <Link prefetch={false} href="/tonight">Tonight</Link>
              <Link prefetch={false} href="/plan">Plan a night</Link>
            </div>
            <div className="lpFooterCol">
              <h2>More</h2>
              <Link prefetch={false} href="/social">{socialLabel}</Link>
              <Link prefetch={false} href="/pal">Pub Pal</Link>
              <Link prefetch={false} href="/places">Pick your city</Link>
              <Link prefetch={false} href="/about">About</Link>
            </div>
          </nav>
        </div>

        <div className="lpFooterBase">
          {/* Small print rail: the two pages a reader is entitled to find from
              any page of the site, plus the brand's general inbox
              (lib/siteContact.mjs). Sits with the over-18 line because that is
              where legal copy lives. */}
          <nav className="lpFooterSmallPrint" aria-label="Small print">
            <Link prefetch={false} href="/privacy">Privacy</Link>
            <Link prefetch={false} href="/terms">Terms of use</Link>
            <DataCreditsLink />
            <a href={HELLO_MAILTO}>Contact</a>
          </nav>
          <p className="lpFooterCredit">© 2026 PUBMAXX / Karan Manoharan</p>
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
