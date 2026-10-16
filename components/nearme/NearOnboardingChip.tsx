"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import {
  getTourSeenServerSnapshot,
  getTourSeenSnapshot,
  subscribeTour,
} from "@/lib/firstRunTour";
import { WEB_ONBOARDING_START_HREF } from "@/lib/firstRunRoute";

import "@/components/ui/chip.css";

/** The words on the chip. Exported so the pins read the same string. */
export const NEAR_ONBOARDING_CHIP_LABEL = "New here? Set your budget and patch";

/**
 * The first-run setup, OFFERED rather than imposed (owner decision 16 Oct
 * 2026). The landing's "Cheapest pints near me" now lands every visitor on
 * `/near?locate=1` and answers first; a first-time visitor (no seen mark,
 * lib/firstRunTour.ts) finds this one quiet chip under the answer instead of a
 * five-step gate in front of it.
 *
 * The server snapshot says "seen", so the prerendered document never carries
 * the chip and hydration never disagrees with it. It is a client navigation,
 * which is what lets `?start=web` past proxy.ts's document rule.
 */
export default function NearOnboardingChip() {
  const seen = useSyncExternalStore(
    subscribeTour,
    getTourSeenSnapshot,
    getTourSeenServerSnapshot,
  );
  if (seen) return null;
  return (
    <p className="nmnFirstRunChip">
      <Link prefetch={false} href={WEB_ONBOARDING_START_HREF} className="uiChip">
        {NEAR_ONBOARDING_CHIP_LABEL}
      </Link>
    </p>
  );
}
