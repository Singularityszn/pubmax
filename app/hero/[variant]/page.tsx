import type { Metadata } from "next";
import { notFound } from "next/navigation";

import LandingPage from "@/components/landing/LandingPage";
import { loadAboutStats } from "@/lib/aboutStats";
import { parseHeroVariant } from "@/lib/landingHero";
import { loadLandingHeroData } from "@/lib/landingPubCard.server";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";

// The landing hero prototype (issue #1357). `/?hero=a|b|c` is rewritten here
// by next.config.mjs so the flag never touches the prerendered, CDN-held root
// document. This route renders per request with the ordinary nonce and is
// never indexed. Delete it with the prototype.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function HeroVariantPage({
  params,
}: {
  params: Promise<{ variant: string }>;
}) {
  const { variant } = await params;
  const heroVariant = parseHeroVariant(variant);
  if (!heroVariant) notFound();
  const [stats, hero] = await Promise.all([loadAboutStats(), loadLandingHeroData()]);
  const socialFriendsLaunchEnabled = readTrustedHandoffFlag("socialFriendsLaunch");
  return (
    <LandingPage
      stats={stats}
      card={hero.card}
      heroVariant={heroVariant}
      heroArchive={hero.archive}
      heroRail={hero.rail}
      socialFriendsLaunchEnabled={socialFriendsLaunchEnabled}
    />
  );
}
