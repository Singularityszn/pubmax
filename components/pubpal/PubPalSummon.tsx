"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PubPal } from "@/lib/pubPal";
import { trackEvent } from "@/lib/analytics";
import { readLocalPal } from "@/lib/localPal";
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
  const pathname = usePathname() ?? "";
  const [pal, setPal] = useState<PubPal | null>(null);
  const [cheer, setCheer] = useState<PalMoment | null>(null);
  useEffect(() => { const value = readLocalPal(); queueMicrotask(() => setPal(value)); }, [pathname]);
  // A finished crawl or night: the chip jumps and says so, then settles.
  useEffect(() => {
    let timer = 0;
    const unsubscribe = subscribePalMoments((moment) => {
      window.clearTimeout(timer);
      setCheer(moment);
      timer = window.setTimeout(() => setCheer(null), PAL_SUMMON_CHEER_MS);
    });
    return () => { unsubscribe(); window.clearTimeout(timer); };
  }, []);
  if (!pal || pal.hidden || !shouldShowPubPalSummon(pathname)) return null;
  return <Link className={cheer ? "palSummon isCheering" : "palSummon"} data-pal-state={pal.muted ? "sleeping" : undefined} href="/pal" aria-label={`Summon ${pal.name}, your Pub Pal`} onClick={() => trackEvent("pub_pal_summoned", { surface: pathname === "/" ? "home" : pathname.startsWith("/map") ? "map" : "plan" })}><PubPalAvatar appearance={pal.appearance} name={pal.name} compact genome={pal.id ? palGenomeFor(pal.id, pal.personality) : undefined}/><span><strong>{pal.name}</strong><small role="status">{cheer ? palSummonCheerLine(cheer) : pal.muted ? "Muted" : "Tap to talk or plan"}</small></span></Link>;
}
