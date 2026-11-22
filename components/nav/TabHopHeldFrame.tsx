"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import RouteHeldFrame, { type RouteHeldFrameShape } from "@/components/nav/RouteHeldFrame";

// What a phone shows between a tab tap and the page it opens.
//
// A route's own loading shell cannot answer the tap, because the shell is
// fetched with the route: on Slow 4G the old page stood for 1.6 to 3.1 s under
// a dock that had not moved. This frame is already in the root shell's code,
// so it needs no request. MobileTabBar mounts it while Next reports the tab's
// link as pending and unmounts it when the route commits or the hop ends.
//
// A hop that lands inside the grace shows nothing, because a frame that
// flashes is worse than the page it stands in for. It is the sample
// skeleton's grace (components/ui/sample-skeleton.tsx): on Fast 4G a hop to
// Plan or You lands in about 500 ms, so a shorter one flashed on most taps.
const HELD_FRAME_GRACE_MS = 600;

type HeldFramePlacement = {
  /** Where the veil starts, in viewport pixels. */
  top: number;
  /** The nav's rectangle at the top of the scroll, when the page has a nav. */
  nav: { top: number; left: number; width: number; height: number } | null;
};

/**
 * The veil draws the destination at the top of its scroll. A page that is
 * already there keeps its own nav on screen and the veil starts under it.
 * Any other page is covered whole, and the veil draws the nav's card where
 * the destination will put it, so the heading sits where it will land.
 */
function placeHeldFrame(): HeldFramePlacement {
  const nav = document.querySelector(".siteNavBar:not(.siteNavBarFloating)");
  if (!nav) return { top: 0, nav: null };
  const rect = nav.getBoundingClientRect();
  if (window.scrollY <= 0) return { top: Math.round(rect.bottom), nav: null };
  return {
    top: 0,
    nav: {
      top: Math.round(rect.top + window.scrollY),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

export default function TabHopHeldFrame({ shape }: { shape: RouteHeldFrameShape }) {
  const [placement, setPlacement] = useState<HeldFramePlacement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setPlacement(placeHeldFrame()), HELD_FRAME_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!placement) return null;
  const { top, nav } = placement;
  const underNav = top > 0;
  const style = {
    top,
    ...(underNav ? { "--tab-hop-nav-reserve": "0px" } : {}),
    ...(nav ? { "--tab-hop-nav-reserve": `${nav.top + nav.height}px` } : {}),
  } as CSSProperties;
  // The tab's own pending indicator announces the hop, so the veil is silent.
  return createPortal(
    <div className={underNav ? "tabHopVeil tabHopVeil--underNav" : "tabHopVeil"} style={style} aria-hidden="true">
      {underNav ? null : (
        <span
          className="tabHopVeilNav"
          style={nav ? { top: nav.top, left: nav.left, right: "auto", width: nav.width, height: nav.height } : undefined}
        />
      )}
      <RouteHeldFrame shape={shape} />
    </div>,
    document.body,
  );
}
