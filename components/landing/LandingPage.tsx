"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, MapPin, Receipt } from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import SignInButton from "@/components/auth/SignInButton";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import CityChooser from "@/components/city/CityChooser";
import MessagesLink from "@/components/nav/MessagesLink";
import NotificationBell from "@/components/nav/NotificationBell";
import ThemeToggle from "@/components/ThemeToggle";
import Kicker from "@/components/ui/kicker";
import Screen from "@/components/ui/screen";
// Shared nav atoms (bell/messages island) carry their styling in siteNav.css.
// The landing bar isn't the SiteNav component, but it flies the same wordmark
// and action cluster, so it pulls in those shared styles directly.
import "@/components/nav/siteNav.css";
import type { AboutStats } from "@/lib/aboutStats";
import type { LandingPubCardData } from "@/lib/landingPubCard";
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

import LandingPubCard from "./LandingPubCard";
import PintDropStripLoading from "./PintDropStripLoading";
import "./landing.css";

function trackLandingCta(target: LandingCtaTarget) {
  trackEvent("landing_cta_clicked", { target });
}

const PintDropStrip = dynamic(() => import("./PintDropStrip"), {
  ssr: false,
  loading: PintDropStripLoading,
});

/** The price receipt door: log what you paid, and the map restamps. */
export const LANDING_PRIMARY_HREF = "/near?locate=1";
export const LANDING_PRIMARY_LABEL = "Log what you paid";

// Locale integer with grouping (2800 -> "2,800"). British thousands separators
// match the receipt-numeral voice used everywhere prices are shown.
function fmtInt(n: number): string {
  return n.toLocaleString("en-GB");
}

// The honest, build-time coverage stats as the hero's proof row. Only counts
// that survived the real dataset (> 0) become figures; a missing or zeroed
// figure is dropped rather than shown as a hollow "0 pubs". Every number here
// is derived in lib/aboutStats; nothing is typed in.
function heroReadout(
  stats: AboutStats | undefined,
): Array<{ icon: typeof MapPin; value: string; label: string }> {
  if (!stats) return [];
  const chips: Array<{ icon: typeof MapPin; value: string; label: string }> = [];
  if (stats.pubsTracked > 0) {
    chips.push({ icon: MapPin, value: fmtInt(stats.pubsTracked), label: "pubs tracked" });
  }
  if (stats.pintPricesObserved > 0) {
    // The CURATED index's priced rows. Some legacy rows do not name a
    // publisher, and only community and first-party update rows carry a
    // genuine per-row date.
    chips.push({ icon: Receipt, value: fmtInt(stats.pintPricesObserved), label: "prices on record" });
  }
  if (stats.boroughsCovered > 0) {
    chips.push({ icon: Building2, value: fmtInt(stats.boroughsCovered), label: "London boroughs" });
  }
  return chips;
}

export default function LandingPage({
  stats,
  card = null,
  // Server-threaded friends-launch flag. Explicit 0 is the rollback state.
  socialFriendsLaunchEnabled = true,
}: {
  stats?: AboutStats;
  /** The one real pub above the fold, or null when the data cannot back one. */
  card?: LandingPubCardData | null;
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

  const readout = heroReadout(stats);
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
            primary action (the price receipt door), the Pal as the quiet second
            door, then one real pub that proves the claim, then the counts. The
            DOM order is the phone order; the desktop only sets the pub card
            beside the copy. */}
        <Screen
          className="lpHero"
          kicker="PUBMAXX"
          title="What a pint costs, pub by pub."
          titleId="hero-title"
          primary={
            <Link
              prefetch={false}
              href={LANDING_PRIMARY_HREF}
              onClick={() => trackLandingCta("receipt")}
            >
              {LANDING_PRIMARY_LABEL}
            </Link>
          }
          secondary={
            <Link prefetch={false} href="/pal" onClick={() => trackLandingCta("pal")}>
              Meet your Pub Pal
            </Link>
          }
        >
          <div className="lpHeroProof">
            {card ? <LandingPubCard card={card} /> : null}
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
            ) : null}
          </div>
        </Screen>

        <section className="lpWhy" id="why" aria-labelledby="why-title">
          <Kicker>Why PUBMAXX</Kicker>
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
            leave a gap than invent a figure.
          </p>
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
              <Link prefetch={false} href="/choose-city">Pick your city</Link>
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
