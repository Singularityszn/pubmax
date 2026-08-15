import type { Metadata } from "next";

import LandingPage from "@/components/landing/LandingPage";
import AppEntryRoute from "@/components/native/AppEntryRoute";
import { loadAboutStats } from "@/lib/aboutStats";

// Self-canonical for the homepage (Wave S1.4). Title/description inherit the
// root layout defaults; this only pins the canonical URL.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function Home() {
  // Real coverage numbers, derived at build/request time from the same bundled
  // pint-price dataset + enabled-city config the rest of the app reads (via the
  // provenance-honest lib/aboutStats). No invented counts — loadAboutStats
  // degrades to zeroed figures on any read failure, and the landing hero falls
  // back to plain copy when a figure is missing. Passed as a plain serialisable
  // prop into the client LandingPage.
  const stats = await loadAboutStats();
  return (
    <>
      {/* Preload the LCP-adjacent hero (a CSS background on .lpHero::before, so
          the browser would otherwise only discover it after CSS parse).
          type=avif → non-AVIF browsers skip these and fall through to the
          image-set WebP/JPEG; media-scoped → each viewport fetches only its
          width. React hoists these to <head>. */}
      <link rel="preload" as="image" href="/landing/hero-thames-1024.avif" type="image/avif" media="(max-width: 768px)" />
      <link rel="preload" as="image" href="/landing/hero-thames-1600.avif" type="image/avif" media="(min-width: 769px)" />
      {/* The only route the entry decision may rewrite (issue #439): shell
          opens (Capacitor wrap, installed PWA) land on /tonight, a genuine
          native first-run opens the one-time onboarding, browser visits
          stay here. Deep links never mount this. No-op on web/SSR. */}
      <AppEntryRoute />
      <LandingPage stats={stats} />
    </>
  );
}
