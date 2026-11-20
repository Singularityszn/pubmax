"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import DataCreditsLink from "@/components/legal/DataCreditsLink";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
// The landing bar isn't the SiteNav component, but it flies the same wordmark
// and renders SiteNav's OWN action cluster (SiteNavActions), so the front door
// and every app page offer one set of controls. SiteNav's module brings the
// shared styles with it.
import { SiteNavActions } from "@/components/nav/SiteNav";
import { MobileWildNightPreviewGate } from "@/components/wild/WildNightPreviewGate";
import { strangerSavingLine, type PintPriceAverages } from "@/lib/pintSavings";
import LandingMapHero from "./LandingMapHero";
import type { OpeningPreviewDisc } from "@/lib/mapOpeningPreviewDiscs";
import type { LandingAnswers } from "@/lib/landingAnswers";
import type { LandingDrinkLink } from "@/lib/landingDiscovery.server";
import type { LandingArchiveIndex, LandingRailRow } from "@/lib/landingHero";
import type { LondonCollageAreaPrice } from "@/lib/landingLondonCollage";
import type { LandingPubCardData } from "@/lib/landingPubCard";
import { PUB_LIST_BASE } from "@/lib/pubListBase";
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
import { useWildMode } from "@/lib/useWildMode";
import type { WildPriceGlass } from "@/lib/wildPriceGlass";
import type { DotFooterCount } from "@/components/wild/DotFooter";

import LandingAnswerCards from "./LandingAnswerCards";
import LandingDiscoveryLinks from "./LandingDiscoveryLinks";
import LandingFaq from "./LandingFaq";
import LandingSavings from "./LandingSavings";
import "./landing.css";

function trackLandingCta(target: LandingCtaTarget) {
  trackEvent("landing_cta_clicked", { target });
}

const PriceGlass = dynamic(() => import("@/components/wild/PriceGlass"), {
  ssr: false,
  loading: () => null,
});
const DotFooter = dynamic(() => import("@/components/wild/DotFooter"), {
  ssr: false,
  loading: () => null,
});

export default function LandingPage({
  openingDiscs = [],
  huntCities = null,
  huntCard = null,
  discoveryDrinks = [],
  priceGlass = null,
  priceReadLine = null,
  averages = null,
  answers = null,
  ukCoverage = null,
  dutyCensus = null,
  // Server-threaded friends-launch flag. Explicit 0 is the rollback state.
  socialFriendsLaunchEnabled = true,
  paydayPintEnabled = false,
}: {
  openingDiscs?: OpeningPreviewDisc[];
  /**
   * The cheapest pint we can find in Britain, rendered on the server
   * (components/landing/LandingHuntCard.tsx). A slot, so its code never ships
   * to the browser.
   */
  huntCard?: ReactNode;
  /**
   * Britain's cheapest pint, city by city, and London's dearest pint, rendered
   * on the server (components/landing/LandingHuntCities.tsx).
   */
  huntCities?: ReactNode;
  /**
   * The before-1-February census card, drawn on the server
   * (components/census/DutyCensusCard.tsx). Seated under Tonight.
   */
  dutyCensus?: ReactNode;
  card?: LandingPubCardData | null;
  archive?: LandingArchiveIndex;
  rail?: LandingRailRow[];
  /** The city's two mean pint prices, for the saving line (lib/pintSavings.ts). */
  averages?: PintPriceAverages | null;
  /** When the prices behind that average were read (lib/landingPubCard.server.ts). */
  priceReadLine?: string | null;
  collagePrices?: Record<string, LondonCollageAreaPrice>;
  /** What is on today and what is on tonight, one sentence each. */
  answers?: LandingAnswers | null;
  /** UK directory listings, never the denominator of a price comparison. */
  ukCoverage?: UkDirectoryCoverage | null;
  /**
   * The Price Glass's pours (lib/wildPriceGlass.ts), built at prerender. Drawn
   * only while the wild switch is on; null pours nothing.
   */
  priceGlass?: WildPriceGlass | null;
  discoveryDrinks?: readonly LandingDrinkLink[];
  socialFriendsLaunchEnabled?: boolean;
  paydayPintEnabled?: boolean;
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
  const wild = useWildMode();
  // The dot footer's one line repeats counts this page already prints, from
  // the same figures and in the same words.
  const dotCounts: DotFooterCount[] = [
    ...(averages
      ? [{
          figure: averages.sampleSize.toLocaleString("en-GB"),
          words: `${averages.sampleSize === 1 ? "pub" : "pubs"} in ${PUB_LIST_BASE} with a listed price`,
        }]
      : []),
    ...(ukCoverage
      ? [{
          figure: ukCoverage.pubListings.toLocaleString("en-GB"),
          words: "UK pub listings from OpenStreetMap",
        }]
      : []),
  ];
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
        <nav
          className="lpPrimaryNav"
          aria-label="Landing navigation"
          onFocus={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
        >
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
      <MobileWildNightPreviewGate />

      <main id="main">
        <LandingMapHero discs={openingDiscs} />
        {answers ? <LandingAnswerCards answers={answers} dutyCensus={dutyCensus} /> : null}
        <details className="landingMore">
          <summary>Explore more prices and places</summary>
          {wild && priceGlass ? <PriceGlass glass={priceGlass} /> : null}
          {huntCard}
          {huntCities}
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
          <LandingDiscoveryLinks drinks={discoveryDrinks} />
          {paydayPintEnabled ? <section className="lpWorth"><Link prefetch={false} href="/payday-pint" className="lpTextLink">Get a weekly payday pint email</Link></section> : null}
          <LandingFaq />
        </details>
      </main>

      <footer className="lpFooter">
        {wild ? <DotFooter counts={dotCounts} /> : null}
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
              {/* Browsing /near must not prompt for location on arrival. */}
              <Link prefetch={false} href="/near">Find my pint</Link>
              <Link prefetch={false} href="/tonight">Tonight</Link>
              <Link prefetch={false} href="/plan">Plan a night</Link>
              <Link prefetch={false} href="/crawls">London pub crawl routes</Link>
            </div>
            <div className="lpFooterCol">
              <h2>More</h2>
              <Link prefetch={false} href="/social">{socialLabel}</Link>
              <Link prefetch={false} href="/pal">Pub Pal</Link>
              <Link prefetch={false} href="/spoons-value">Spoons</Link>
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
