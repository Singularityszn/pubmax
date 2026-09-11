"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import SignInButton from "@/components/auth/SignInButton";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import CityChooser from "@/components/city/CityChooser";
import MessagesLink from "@/components/nav/MessagesLink";
import NotificationBell from "@/components/nav/NotificationBell";
import ThemeToggle from "@/components/ThemeToggle";
import Kicker from "@/components/ui/kicker";
// Shared nav atoms (bell/messages island) carry their styling in siteNav.css.
// The landing bar isn't the SiteNav component, but it flies the same wordmark
// and action cluster, so it pulls in those shared styles directly.
import "@/components/nav/siteNav.css";
import type { LandingAnswers } from "@/lib/landingAnswers";
import type { LandingArchiveIndex, LandingRailRow } from "@/lib/landingHero";
import type { LandingPubCardData } from "@/lib/landingPubCard";
import type { PintPriceAverages } from "@/lib/pintSavings";
import {
  preferredCityMapHref,
  readPreferredCity,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { warmMapRoute } from "@/lib/mapWarmup";
import { CONTACT_MAILTO } from "@/lib/siteContact";
import { trackEvent } from "@/lib/analytics";
import type { LandingCtaTarget } from "@/lib/analyticsEvents";
import { socialSurfaceName } from "@/lib/socialLaunch";

import LandingAnswerCards from "./LandingAnswerCards";
import LandingFaq from "./LandingFaq";
import LandingHero from "./LandingHero";
import LandingSavings from "./LandingSavings";
import PintDropStripLoading from "./PintDropStripLoading";
import "./landing.css";

function trackLandingCta(target: LandingCtaTarget) {
  trackEvent("landing_cta_clicked", { target });
}

const PintDropStrip = dynamic(() => import("./PintDropStrip"), {
  ssr: false,
  loading: PintDropStripLoading,
});

export default function LandingPage({
  card = null,
  archive = {},
  rail = [],
  averages = null,
  answers = null,
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
  /** What is on today and what is on tonight, one sentence each. */
  answers?: LandingAnswers | null;
  socialFriendsLaunchEnabled?: boolean;
}) {
  const router = useRouter();
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
        <Link prefetch={false} href="/" className="lpWordmark" aria-label="PUBMAXXING home">
          <PubmaxxWordmark />
        </Link>

        <nav className="lpPrimaryNav" aria-label="Landing navigation">
          <Link prefetch={false} href={mapCtaHref} {...warmProps}>Map</Link>
          <Link prefetch={false} href="/plan">Plan</Link>
          <Link prefetch={false} href="/tonight">Tonight</Link>
          <Link prefetch={false} href="/moment">Moment</Link>
          <Link prefetch={false} href="/social">{socialLabel}</Link>
          <Link prefetch={false} href="/u/you">You</Link>
        </nav>

        <div className="lpNavActions">
          {/* Canonical action island, same order and shape as SiteNav so the
              front door and the app read as one product. Bell and Messages are
              anon-safe (plain icon links, badge only when signed-in + unread). */}
          <NotificationBell />
          <MessagesLink />
          <ThemeToggle />
          <SignInButton compact />
        </div>
      </header>

      <main id="main">
        {/* The whole first screen, at every width: brand kicker, the claim, one
            line under it, the drawing of London, one primary action (Cheapest
            pints near me), the quiet row of the receipt door and Tonight, then
            the one real pub and three next-cheapest rows. The DOM order is the
            phone order; the desktop only seats the picture and the rows beside
            the copy. */}
        <LandingHero card={card} archive={archive} rail={rail} />

        {answers ? <LandingAnswerCards answers={answers} /> : null}

        <section className="lpWorth" aria-labelledby="worth-title">
          <Kicker>What it saves you</Kicker>
          <h2 id="worth-title">The cheapest listed pint near you, on one map.</h2>
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

        <div id="cities" className="lpCityChooser">
          <CityChooser variant="section" />
        </div>
      </main>

      <footer className="lpFooter">
        <div className="lpFooterInner">
          <div className="lpFooterBrand">
            <Link prefetch={false} href="/" className="lpWordmark" aria-label="PUBMAXXING home">
              <PubmaxxWordmark />
            </Link>
            <p className="lpFooterProvenance">
              When a price record names a publisher, we name and link it. When no
              publisher is recorded, the price says so. The ones drinkers log come
              with the day they were seen, and no pub can pay to rank higher.
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
              <h2>The good stuff</h2>
              <Link prefetch={false} href="/social">{socialLabel}</Link>
              <Link prefetch={false} href="/pal">Pub Pal</Link>
              <Link prefetch={false} href="/places">Pick your city</Link>
              <Link prefetch={false} href="/about">Our story</Link>
            </div>
          </nav>
        </div>

        <div className="lpFooterBase">
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
