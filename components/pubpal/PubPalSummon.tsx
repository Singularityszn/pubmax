"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/authContext";
import { trackEvent } from "@/lib/analytics";
import { isPlanActiveNow, subscribeActivePlan } from "@/lib/activePlan";
import { useOwnedActivePlan } from "@/components/night/useOwnedActivePlan";
import { useOwnPal } from "@/components/pal/useOwnPal";
import { readShowableMorningNight } from "@/lib/morningReentry";
import { palSummonLine } from "@/lib/palSummonLine";
import { subscribePalMoments, type PalMoment } from "@/lib/palMoments";
import { PubPalAvatar } from "./PubPalAvatar";
import { palGenomeFor } from "@/lib/palGenome";

/** How long the chip celebrates a moment before it goes back to its offer. */
export const PAL_SUMMON_CHEER_MS = 6_000;

export function shouldShowPubPalSummon(pathname: string): boolean {
  return pathname === "/" || pathname === "/map" || pathname.startsWith("/map/") || pathname === "/plan" || pathname.startsWith("/plan/");
}

/** What the chip says while it celebrates: what happened, never a score. */
export function palSummonCheerLine(moment: PalMoment): string {
  if (moment.kind === "price-added") return "Thanks for the price";
  if (moment.kind === "night-finished") return "That's the night";
  return moment.stops > 1 ? `Walked all ${moment.stops} stops` : "Walked it";
}

export default function PubPalSummon() {
  const { user, loading } = useAuth();
  const ownerId = loading ? null : user?.id ?? null;
  const pathname = usePathname() ?? "";
  if (!ownerId) return null;
  // Each account gets a new instance before paint. Old callbacks cannot
  // transfer a cheer or a night offer into the next account's instance.
  return <OwnedPubPalSummon key={ownerId} ownerId={ownerId} pathname={pathname} />;
}

function OwnedPubPalSummon({ ownerId, pathname }: { ownerId: string; pathname: string }) {
  const pal = useOwnPal();
  const ownPlan = useOwnedActivePlan();
  const [cheer, setCheer] = useState<PalMoment | null>(null);
  const [offer, setOffer] = useState<{ nightOnStop: number | null; nightKept: boolean; hour: number } | null>(null);
  // What the Pal offers now: a night that is on, a kept night, or the hour.
  useEffect(() => {
    let active = true;
    const read = () => {
      if (!active) return;
      const now = Date.now();
      const morningNight = readShowableMorningNight(now);
      setOffer({
        nightOnStop: ownPlan && isPlanActiveNow(ownPlan, now) ? ownPlan.stopIndex : null,
        nightKept: Boolean(ownPlan && morningNight?.planId === ownPlan.id),
        hour: new Date(now).getHours(),
      });
    };
    queueMicrotask(read);
    const unsubscribe = subscribeActivePlan(read);
    return () => { active = false; unsubscribe(); };
  }, [pathname, pal, ownPlan]);
  // A finished crawl or night: the chip jumps and says so, then settles.
  useEffect(() => {
    let active = true;
    let timer = 0;
    const unsubscribe = subscribePalMoments((moment) => {
      if (!active) return;
      window.clearTimeout(timer);
      setCheer(moment);
      timer = window.setTimeout(() => { if (active) setCheer(null); }, PAL_SUMMON_CHEER_MS);
    });
    return () => { active = false; unsubscribe(); window.clearTimeout(timer); };
  }, []);
  if (!ownerId || !pal || pal.ownerId !== ownerId || pal.hidden || !shouldShowPubPalSummon(pathname)) return null;
  return <Link className={cheer ? "palSummon isCheering" : "palSummon"} data-pal-state={pal.muted ? "sleeping" : undefined} href="/pal" aria-label={`Summon ${pal.name}, your Pub Pal`} onClick={() => trackEvent("pub_pal_summoned", { surface: pathname === "/" ? "home" : pathname.startsWith("/map") ? "map" : "plan" })}><PubPalAvatar appearance={pal.appearance} name={pal.name} compact genome={pal.id ? palGenomeFor(pal.id, pal.personality) : undefined}/><span><strong>{pal.name}</strong><small role="status">{cheer ? palSummonCheerLine(cheer) : offer ? palSummonLine({ ...offer, muted: pal.muted }) : pal.muted ? "Muted" : "Tap to talk or plan"}</small></span></Link>;
}
