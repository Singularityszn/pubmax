import type { Metadata } from "next";

import LandingPage from "@/components/landing/LandingPage";
import LandingSkylinePreload from "@/components/landing/LandingSkylinePreload";
import AppEntryRoute from "@/components/native/AppEntryRoute";
import { loadLandingAnswers } from "@/lib/landingAnswers.server";
import { loadLandingHeroData } from "@/lib/landingPubCard.server";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";

// The words a forwarded link shows beside the card. They say the same thing the
// page itself says, because a referral link (/r/<code>) lands on /#referral=…
// and so previews THIS head: the description is the landing hero's lede, the
// same line lib/homeOgCard.tsx prints on the share card.
const HOME_TITLE = "PUBMAXXING: what a pint costs, pub by pub";
const HOME_DESCRIPTION =
  "London on one map, with 298 historic pubs marked and a listed price wherever we hold one. Who listed it, and the day they did.";

// Self-canonical for the homepage (Wave S1.4). Title/description inherit the
// root layout defaults; this pins the canonical URL and the homepage's own
// share card.
//
// The card is drawn by /api/home-card, not by a root opengraph-image.tsx file
// convention: at the root segment that convention puts the whole card kit
// (next/og, its wasm, sharp, the brand fonts and the price dataset it counts)
// inside the deployed function of EVERY page, which is about 11 MB of
// cold-start weight per route. app/api/home-card/route.tsx carries the
// measurement. Next replaces a parent's openGraph object wholesale rather than
// merging it, so the homepage restates the fields it keeps.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: "https://pubmaxxing.com",
    siteName: "PUBMAXX",
    type: "website",
    images: [
      {
        url: "/api/home-card",
        width: 1200,
        height: 630,
        // No count here: this string is static metadata, so a figure typed in
        // would rot while the card's own figures are derived per render.
        alt: "PUBMAXXING. Listed pint prices on one map, across London and more UK cities",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    images: ["/api/home-card"],
  },
};

// THIS DOCUMENT IS PRERENDERED (captain decision 2026-08-09, recorded in
// proxy.ts): it drops the per-request CSP nonce so the Vercel CDN can hold it.
// Two rules follow, and both are enforced by tests:
//
//   1. Nothing per-request may be read here. `force-static` makes that a build
//      error rather than a silent per-request render, and it is also what stops
//      the root layout's nonce read (`headers()`) from pulling this route back
//      into dynamic rendering.
//   2. Nothing personal may reach this document. One prerendered copy is handed
//      to every stranger, so the viewer's handle, session and saved state are
//      fetched by the client after load, never rendered here.
//
// The physical QR path (PLG Wave 2) used to be answered here: printed codes use
// /?src=poster (+ optional utm_*) and the arrival goes to /near with the
// campaign query kept. Reading that query is per-request work, so proxy.ts now
// redirects it before this route is reached. lib/posterLanding.ts still owns
// where it lands.
export const dynamic = "force-static";
// The shipped price dataset, the price archive and the flag env change only on
// deploy. The two answer cards do not: they read the weather store and the
// listing lanes, so an hour is what bounds how stale the front door's "today"
// and "tonight" sentences can get. Each card stamps the London day it speaks
// for, so a held copy says which day it is talking about rather than passing
// itself off as now.
export const revalidate = 3600;

export default async function Home() {
  // The one real pub above the fold, the archive's then rows and the three
  // next-cheapest rows, built at prerender from the same priced index plus the
  // price archive. A null card renders no card and the plain receipt door,
  // never an invented pub. Passed as plain serialisable props into the client
  // LandingPage.
  const [{ card, archive, rail, averages }, answers] = await Promise.all([
    loadLandingHeroData(),
    // What is on today and what is on tonight, read at prerender from the same
    // lanes /today and /tonight read. Both fail soft to an honest line, so a
    // provider that is down cannot fail the build or invent a night.
    loadLandingAnswers(),
  ]);
  // Soft launch keeps friends-launch unset/off. Thread the same gate the Social
  // APIs use so Memory CTAs never promise "Open Social" while /social still
  // answers "not open yet."
  const socialFriendsLaunchEnabled = readTrustedHandoffFlag("socialFriendsLaunch");

  return (
    <>
      <LandingSkylinePreload phoneAnswerOwnsLcp={card !== null} />
      {/* The only route the entry decision may rewrite (issue #439): shell
          opens (Capacitor wrap, installed PWA) land on /tonight, a genuine
          native first-run opens onboarding until Skip or Plan my night, browser visits
          stay here. Deep links never mount this. No-op on web/SSR. */}
      <AppEntryRoute />
      <LandingPage
        card={card}
        archive={archive}
        rail={rail}
        averages={averages}
        answers={answers}
        socialFriendsLaunchEnabled={socialFriendsLaunchEnabled}
      />
    </>
  );
}
