"use client";

import { useEffect, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
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
import { parseCityId } from "@/lib/cities";
import { requestPalVoiceStart } from "@/lib/palVoiceHost";
import { usePalVoiceAvailability } from "./usePalVoiceAvailability";

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

function onMapPath(pathname: string): boolean {
  return pathname === "/map" || pathname.startsWith("/map/");
}

/** Voice talks about London today, so a map of another city says so on the chip. */
export function palSummonOutsideLondon(pathname: string): boolean {
  const city = pathname.startsWith("/map/") ? parseCityId(pathname.split("/")[2]) : null;
  return city !== null && city !== "london";
}

const SIGN_IN_CHIP_CLOSED_KEY = "pubmax:pal-sign-in-chip:closed:v1";

function readSignInChipClosed(): boolean {
  try {
    return window.localStorage.getItem(SIGN_IN_CHIP_CLOSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Signed out on the map: the way in to a Pal, and a way to put it away. */
function SignInPalChip({ pathname }: { pathname: string }) {
  const [closed, setClosed] = useState(readSignInChipClosed);
  if (closed) return null;
  const close = () => {
    setClosed(true);
    try {
      window.localStorage.setItem(SIGN_IN_CHIP_CLOSED_KEY, "1");
    } catch {
      // A private window keeps the chip closed for this visit only.
    }
  };
  const href = `/login?${new URLSearchParams({ mode: "signin", from: pathname }).toString()}` as Route;
  return (
    <div className="palSummon palSummonSignIn">
      <Link href={href} onClick={() => trackEvent("pub_pal_summoned", { surface: "map" })}>
        <strong>Sign in to talk to your Pal</strong>
      </Link>
      <IconButton variant="ghost" aria-label="Close" onClick={close}><X size={16} aria-hidden="true" /></IconButton>
    </div>
  );
}

export default function PubPalSummon() {
  const { user, loading } = useAuth();
  const ownerId = loading ? null : user?.id ?? null;
  const pathname = usePathname() ?? "";
  if (!ownerId) return !loading && onMapPath(pathname) ? <SignInPalChip pathname={pathname} /> : null;
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
  const genome = pal.id ? palGenomeFor(pal.id, pal.personality) : undefined;
  const line = cheer ? palSummonCheerLine(cheer) : offer ? palSummonLine({ ...offer, muted: pal.muted }) : pal.muted ? "Muted" : "Tap to talk or plan";
  if (onMapPath(pathname) && !pal.muted) {
    return <MapPalTalk pal={pal} genome={genome} cheer={cheer !== null}
      line={palSummonOutsideLondon(pathname) ? "Talks about London for now" : line} />;
  }
  return <Link className={cheer ? "palSummon isCheering" : "palSummon"} data-pal-state={pal.muted ? "sleeping" : undefined} href="/pal" aria-label={`Summon ${pal.name}, your Pub Pal`} onClick={() => trackEvent("pub_pal_summoned", { surface: pathname === "/" ? "home" : pathname.startsWith("/map") ? "map" : "plan" })}><PubPalAvatar appearance={pal.appearance} name={pal.name} compact genome={genome}/><span><strong>{pal.name}</strong><small role="status">{line}</small></span></Link>;
}

/**
 * On the map, a tap starts voice where the person is, and the call draws as
 * the voice bar. Until the deployment says voice is on, the chip keeps its
 * link to the Pal page.
 */
function MapPalTalk({ pal, genome, cheer, line }: {
  pal: NonNullable<ReturnType<typeof useOwnPal>>;
  genome: ReturnType<typeof palGenomeFor> | undefined;
  cheer: boolean;
  line: string;
}) {
  const availability = usePalVoiceAvailability();
  const face = <PubPalAvatar appearance={pal.appearance} name={pal.name} compact genome={genome}/>;
  const words = <span><strong>{pal.name}</strong><small role="status">{line}</small></span>;
  const className = cheer ? "palSummon isCheering" : "palSummon";
  if (availability !== "available") {
    return <Link className={className} href="/pal" aria-label={`Summon ${pal.name}, your Pub Pal`}
      onClick={() => trackEvent("pub_pal_summoned", { surface: "map" })}>{face}{words}</Link>;
  }
  return <button type="button" className={className} aria-label={`Talk to ${pal.name}, your Pub Pal`}
    onClick={() => {
      trackEvent("pub_pal_summoned", { surface: "map" });
      requestPalVoiceStart({ palName: pal.name, appearance: pal.appearance, genome });
    }}>{face}{words}</button>;
}
