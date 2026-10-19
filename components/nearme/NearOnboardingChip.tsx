"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import {
  getTourSeenServerSnapshot,
  getTourSeenSnapshot,
  subscribeTour,
} from "@/lib/firstRunTour";
import { WEB_ONBOARDING_START_HREF } from "@/lib/firstRunRoute";
import { isNativeApp } from "@/lib/nativePlatform";

/** The words on the chip. Exported so the pins read the same string. */
export const NEAR_ONBOARDING_CHIP_LABEL = "New here? Set your budget and patch";

/**
 * The first-run setup, OFFERED rather than imposed (owner decision 16 Oct
 * 2026). The landing's "Cheapest pints near me" now lands every visitor on
 * `/near?locate=1` and answers first; a first-time visitor (no seen mark,
 * lib/firstRunTour.ts) finds this one quiet chip under the answer instead of a
 * five-step gate in front of it. It is a quiet text link: drawn as a chip it
 * read as one more area to pick beside the patch chips (taste plan, 18 Oct
 * 2026).
 *
 * The server snapshot says "seen", so the prerendered document never carries
 * the chip and hydration never disagrees with it. It is a client navigation,
 * which is what lets `?start=web` past proxy.ts's document rule.
 *
 * It is a WEB door: inside the native shell FirstRunOnboardingGate ignores
 * `?start=web` and, with no native handoff, sends the reader to /tonight, so a
 * fresh install that deep-links to /near is not offered it.
 */
export default function NearOnboardingChip() {
  const seen = useSyncExternalStore(
    subscribeTour,
    getTourSeenSnapshot,
    getTourSeenServerSnapshot,
  );
  // Probed only after the seen check: the hydration render reads the server
  // snapshot ("seen") and returns before this, so it cannot disagree.
  if (seen || isNativeApp()) return null;
  return (
    <p className="nmnFirstRunChip">
      <Link prefetch={false} href={WEB_ONBOARDING_START_HREF} className="nmnFirstRunLink">
        {NEAR_ONBOARDING_CHIP_LABEL}
      </Link>
    </p>
  );
}
