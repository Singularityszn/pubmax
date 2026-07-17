import type { Metadata } from "next";

import LandingPage from "@/components/landing/LandingPage";
import NativeFirstRunRoute from "@/components/native/NativeFirstRunRoute";

// Self-canonical for the homepage (Wave S1.4). Title/description inherit the
// root layout defaults; this only pins the canonical URL.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      {/* Capacitor remote-URL wrap always opens here first — on a genuine
          first native launch (no city preference yet) this replaces the
          landing page with the map, once. No-op on web/SSR/later launches. */}
      <NativeFirstRunRoute />
      <LandingPage />
    </>
  );
}
