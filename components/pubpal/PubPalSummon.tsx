"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import type { PubPal } from "@/lib/pubPal";
import { readOwnedPalCache, subscribePalCache } from "@/lib/pubPalCache";
import { trackEvent } from "@/lib/analytics";
import { PubPalAvatar } from "./PubPalAvatar";

export function shouldShowPubPalSummon(pathname: string): boolean {
  return pathname === "/" || pathname === "/map" || pathname.startsWith("/map/") || pathname === "/plan" || pathname.startsWith("/plan/");
}

export default function PubPalSummon() {
  const pathname = usePathname() ?? "";
  const { user, loading } = useAuth();
  const { signedIn } = useViewerSession();
  const ownerId = !loading && signedIn ? user?.id ?? "" : "";
  const [pal, setPal] = useState<PubPal | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) setPal(readOwnedPalCache(ownerId));
    };
    queueMicrotask(refresh);
    const unsubscribe = subscribePalCache(refresh);
    return () => { active = false; unsubscribe(); };
  }, [ownerId, pathname]);
  if (!ownerId || !pal || pal.ownerId !== ownerId || pal.hidden || !shouldShowPubPalSummon(pathname)) return null;
  return <Link className="palSummon" href="/pal" aria-label={`Summon ${pal.name}, your Pub Pal`} onClick={() => trackEvent("pub_pal_summoned", { surface: pathname === "/" ? "home" : pathname.startsWith("/map") ? "map" : "plan" })}><PubPalAvatar appearance={pal.appearance} name={pal.name} compact/><span><strong>{pal.name}</strong><small>{pal.muted ? "Muted" : "Tap to talk or plan"}</small></span></Link>;
}
