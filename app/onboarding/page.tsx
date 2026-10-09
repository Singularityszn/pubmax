import type { Metadata } from "next";

import FirstRunOnboardingGate from "@/components/onboarding/FirstRunOnboardingGate";
import { getNightAreasForCity } from "@/lib/nightAreas";

import "../pal/pal.css";
import "./onboarding.css";

export const metadata: Metadata = {
  title: "Set up your first night | PUBMAXXING",
  description: "Pick London, set a pint budget, find your cheapest pint nearby and choose a Pub Pal.",
  robots: { index: false, follow: false },
};

export default function OnboardingPage() {
  const reviewedAreas = getNightAreasForCity("london")
    .filter((area) => area.gate.passed)
    .slice(0, 3)
    .map((area) => ({
      name: area.name,
      transportAnchor: area.transportAnchors[0]!,
    }));

  return <FirstRunOnboardingGate reviewedAreas={reviewedAreas} />;
}
