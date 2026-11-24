"use client";

import Link from "next/link";
import DataCreditsLink from "@/components/legal/DataCreditsLink";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import SiteNav from "@/components/nav/SiteNav";
import type { LandingArchiveIndex, LandingRailRow } from "@/lib/landingHero";
import type { LandingPubCardData } from "@/lib/landingPubCard";
import {
  preferredCityMapHref,
  readPreferredCity,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { warmMapRoute } from "@/lib/mapWarmup";
import { HELLO_MAILTO } from "@/lib/siteContact";
import { trackEvent } from "@/lib/analytics";
import { socialSurfaceName } from "@/lib/socialLaunch";

import LandingFaq from "./LandingFaq";
import LandingHero from "./LandingHero";
import "./landing.css";

export default function LandingPage({
  card = null,
  archive = {},
  rail = [],
  huntCities = null,

  socialFriendsLaunchEnabled = true,
}: {
  card?: LandingPubCardData | null;
  archive?: LandingArchiveIndex;
  rail?: LandingRailRow[];
  huntCities?: ReactNode;
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
      <SiteNav active="home" socialLabel={socialLabel} />

      <main id="main">
        <LandingHero card={card} archive={archive} rail={rail} />
        {huntCities}
        <LandingFaq />
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
