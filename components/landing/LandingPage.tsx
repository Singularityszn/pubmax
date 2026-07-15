"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CalendarClock,
  Camera,
  Coins,
  Compass,
  MapPin,
  MessageSquareText,
  Route,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import SignInButton from "@/components/auth/SignInButton";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import CityChooser from "@/components/city/CityChooser";
import ThemeToggle from "@/components/ThemeToggle";
import {
  preferredCityMapHref,
  readPreferredCity,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { warmMapRoute } from "@/lib/mapWarmup";
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
    title: "Prices you can trust",
    body: "Observed prices carry dates and provenance, so a cheap pint never arrives as a vague promise.",
  },
  {
    icon: CalendarClock,
    title: "A city that changes with you",
    body: "Morning calm, after-work energy and late-night events appear when they are useful—not all at once.",
  },
  {
    icon: Route,
    title: "One route, every way there",
    body: "See distance, walking and transport choices without losing the place you were actually trying to reach.",
  },
] as const;

const MEMORY_STEPS = [
  { icon: Compass, n: "01", title: "Find the side quest", body: "Start with a mood, a price or something happening nearby." },
  { icon: UsersRound, n: "02", title: "Bring the crew", body: "Turn a saved place into a night people can join and shape together." },
  { icon: Camera, n: "03", title: "Keep the moment", body: "Capture what happened privately, then publish only what everyone approves." },
] as const;

export default function LandingPage() {
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

  useEffect(() => {
    const hour = new Date().getHours();
    const daypart = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "night";
    trackEvent("discovery_viewed", { surface: "landing", daypart });
  }, []);

  return (
    <div className="lp">
      <header className="lpNav">
        <Link href="/" className="lpWordmark" aria-label="PUBMAXXING home">
          <span className="lpMark" aria-hidden="true">P<span>XX</span></span>
          <PubmaxxWordmark />
        </Link>

        <nav className="lpPrimaryNav" aria-label="Landing navigation">
          <Link href={primaryCtaHref} {...warmProps}>Map</Link>
          <Link href="/tonight">Tonight</Link>
          <Link href="/moment">Moment</Link>
          <Link href="/feed">Stories</Link>
          <Link href="/u/you">You</Link>
        </nav>

        <div className="lpNavActions">
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
            <p className="lpHeroKicker"><span /> London is live</p>
            <h1 id="hero-title">Make tonight worth remembering.</h1>
            <p className="lpHeroLede">Real prices, live plans and unexpected places—built for better nights with your people.</p>
            <div className="lpHeroActions">
              <Link className="lpButton lpButtonPrimary" href={primaryCtaHref} {...warmProps}>
                Open the map <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link className="lpButton lpButtonQuiet" href="#wedge">
                <Sparkles size={17} aria-hidden="true" /> How it works
              </Link>
              <Link className="lpButton lpButtonQuiet" href="/pal">
                <MessageSquareText size={17} aria-hidden="true" /> Meet your Pub Pal
              </Link>
            </div>
            <div className="lpLiveReadout" aria-label="Product highlights">
              <span><MapPin size={15} aria-hidden="true" /> Price-aware places</span>
              <span><Sparkles size={15} aria-hidden="true" /> Side quests nearby</span>
            </div>
          </div>

          <figure className="lpHeroMap">
            <ThamesHero />
            <figcaption>Tap a drink-shaped signal to open that kind of night.</figcaption>
          </figure>
        </section>

        <section className="lpSignalSection" id="wedge" aria-labelledby="signal-title">
          <div className="lpSectionIntro">
            <h2 id="signal-title">The city, with signal.</h2>
            <p>PUBMAXX clears away the listings noise and keeps the three things that change your decision.</p>
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
              <p>Your Night Memory stays private. When the crew is ready, turn approved moments into a Story worth reliving.</p>
              <div className="lpMemoryActions">
                <Link href="/plan" className="lpButton lpButtonPrimary">Start a plan</Link>
              <Link href="/feed" className="lpTextLink">Explore stories <ArrowRight size={16} aria-hidden="true" /></Link>
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
            <p>Pint Drops keep prices fresh, Stories reveal the atmosphere, and every useful contribution carries its source.</p>
          </div>
          <PintDropStrip />
          <div className="lpPalCallout" id="landlord">
            <span className="lpPalIcon"><MessageSquareText size={23} aria-hidden="true" /></span>
            <div><h3>Ask your Pub Pal</h3><p>Turn a mood, budget or half-formed idea into a grounded plan—then confirm every change yourself.</p></div>
            <Link href="/pal" className="lpTextLink">Meet your Pub Pal <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>

        <div id="cities" className="lpCityChooser">
          <CityChooser variant="section" />
        </div>

        <section className="lpFinalCta" aria-labelledby="final-title">
          <div className="lpFinalLines" aria-hidden="true"><span /><span /><span /></div>
          <p>PUBMAXX · Make a memory, not a spreadsheet</p>
          <h2 id="final-title">Your city is already happening.</h2>
          <Link href={primaryCtaHref} className="lpButton lpButtonPrimary" {...warmProps}>
            Open the map <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
      </main>
    </div>
  );
}
