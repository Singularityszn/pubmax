"use client";

import Link from "next/link";
import { Bird } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { useAuth } from "@/components/auth/authContext";
import { PubPalMascot } from "@/components/pal/PubPalMascot";
import NavPendingIndicator from "@/components/nav/NavPendingIndicator";
import { readLocalPal, subscribeLocalPal } from "@/lib/localPal";
import { palGenomeFor, palGenomeStyle } from "@/lib/palGenome";
import { subscribePalMoments } from "@/lib/palMoments";
import type { PubPal } from "@/lib/pubPal";
import { pubPalMascotSlugFor } from "@/lib/pubPalMascot";
import "./navigation.css";

// The Pub Pal's own door in the navigation: the raised button in the middle of
// the phone dock (MobileTabBar.tsx) and the Pal button in the desktop bar
// (SiteNav.tsx). It opens /pal, where a stranger meets a Pal and a person with
// one talks to it. It is a door, not a sixth destination in the loop
// (navigationModel.ts keeps the five), and it is there from the first paint.
//
// Only a person's OWN stored Pal puts a face on it: the Pal stored on this
// device must belong to the account signed in now, because signing out does
// not clear it and a shared device must not show the last account's Pal to
// the next. A stranger, a signed-out device, another account, or a person who
// hid their Pal from shortcuts sees a drawn bird, so the door costs a stranger
// no image request on any page. A muted Pal is shown asleep, and a
// Pal moment (lib/palMoments.ts) makes the face hop once.

const PAL_NAV_HREF = "/pal";

/** How long the face hops after a Pal moment. */
const PAL_NAV_CHEER_MS = 1_200;

/**
 * The Pal whose face the door may show: the one stored on this device, owned
 * by the account signed in now, and not hidden.
 */
export function palForNav(pal: PubPal | null, accountId: string | null): PubPal | null {
  if (!pal || pal.hidden || !accountId || pal.ownerId !== accountId) return null;
  return pubPalMascotSlugFor(pal.appearance.species) ? pal : null;
}

/** The door's accessible name. */
export function palNavLabel(pal: PubPal | null): string {
  return pal ? `Pub Pal, ${pal.name}` : "Pub Pal";
}

/** Whether /pal is the page open now. */
export function palNavActive(pathname: string): boolean {
  return pathname === PAL_NAV_HREF || pathname.startsWith(`${PAL_NAV_HREF}/`);
}

function usePalForNav(pathname: string): { pal: PubPal | null; cheering: boolean } {
  const accountId = useAuth().user?.id ?? null;
  const [pal, setPal] = useState<PubPal | null>(null);
  const [cheering, setCheering] = useState(false);
  // Read after mount, on every page change and whenever the stored Pal
  // changes, in this tab or another, so a Pal made, renamed, hidden or deleted
  // on /pal shows here at once.
  useEffect(() => {
    const read = () => setPal(palForNav(readLocalPal(), accountId));
    queueMicrotask(read);
    return subscribeLocalPal(read);
  }, [pathname, accountId]);
  useEffect(() => {
    let timer = 0;
    const unsubscribe = subscribePalMoments(() => {
      window.clearTimeout(timer);
      setCheering(false);
      // A new frame restarts the hop when moments land close together.
      window.requestAnimationFrame(() => setCheering(true));
      timer = window.setTimeout(() => setCheering(false), PAL_NAV_CHEER_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);
  // Checked again against the account signed in NOW, during render, so a switch
  // never paints the last account's Pal for the frame before the read above.
  return { pal: palForNav(pal, accountId), cheering };
}

function PalNavFace({ pal, size }: { pal: PubPal | null; size: 48 | 32 }) {
  if (!pal) {
    return (
      <span className="palNavFace palNavFace--bird" aria-hidden="true">
        {size === 48 ? <Bird size={24} /> : <Bird size={20} />}
      </span>
    );
  }
  const genome = palGenomeFor(pal.id, pal.personality);
  return (
    <span
      className="palNavFace"
      aria-hidden="true"
      data-pal-state={pal.muted ? "sleeping" : undefined}
      style={palGenomeStyle(genome) as CSSProperties}
    >
      <PubPalMascot species={pal.appearance.species} size={size} circular decorative className="palNavFaceImg" />
    </span>
  );
}

/** The raised Pal button in the middle of the phone dock. */
export function PalDockButton({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { pal, cheering } = usePalForNav(pathname);
  const active = palNavActive(pathname);
  return (
    <Link
      href={PAL_NAV_HREF}
      prefetch={false}
      className={"mobileTabPal pressable navPendingLink" + (active ? " isActive" : "") + (cheering ? " isCheering" : "")}
      aria-label={palNavLabel(pal)}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <PalNavFace pal={pal} size={48} />
      <span className="mobileTabLabel">
        <span className="mobileTabLabelText">Pal</span>
      </span>
      <NavPendingIndicator />
    </Link>
  );
}

/** The Pal button in the desktop bar: the face and the Pal's name. */
export function PalSiteNavButton({ pathname }: { pathname: string }) {
  const { pal, cheering } = usePalForNav(pathname);
  const active = palNavActive(pathname);
  return (
    <Link
      href={PAL_NAV_HREF}
      prefetch={false}
      className={"siteNavPal navPendingLink" + (active ? " isActive" : "") + (cheering ? " isCheering" : "")}
      aria-label={palNavLabel(pal)}
      aria-current={active ? "page" : undefined}
      title={palNavLabel(pal)}
    >
      <PalNavFace pal={pal} size={32} />
      <span className="siteNavPalName">{pal ? pal.name : "Pal"}</span>
      <NavPendingIndicator />
    </Link>
  );
}
