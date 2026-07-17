import type { Metadata } from "next";

import LandingPage from "@/components/landing/LandingPage";

// Self-canonical for the homepage (Wave S1.4). Title/description inherit the
// root layout defaults; this only pins the canonical URL.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return <LandingPage />;
}
