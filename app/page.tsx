import type { Metadata } from "next";

import LandingPage from "@/components/landing/LandingPage";
import AppEntryRoute from "@/components/native/AppEntryRoute";

// Self-canonical for the homepage (Wave S1.4). Title/description inherit the
// root layout defaults; this only pins the canonical URL.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      {/* The only route the entry decision may rewrite (issue #439): shell
          opens (Capacitor wrap, installed PWA) land on /tonight, a genuine
          native first-run keeps the one-time map onboarding, browser visits
          stay here. Deep links never mount this. No-op on web/SSR. */}
      <AppEntryRoute />
      <LandingPage />
    </>
  );
}
