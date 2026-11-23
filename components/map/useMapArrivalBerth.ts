"use client";

import { useLayoutEffect, type RefObject } from "react";

type Berth = {
  /** The custom property the controls read. */
  property: string;
  /** The layout on which the surface sits in the controls' lane. */
  media: string;
  /** The element that carries the property. */
  host: (node: HTMLElement) => HTMLElement | null;
  /** The berth in px, read from the surface's own box. */
  measure: (node: HTMLElement) => number;
};

// The server prelude and the live card can both be mounted while one hands
// over to the other, so each property holds every surface's berth and
// publishes the largest. A surface that hides cannot clear another's berth.
const surfaces = new Map<string, Map<HTMLElement, number>>();

function publish(host: HTMLElement, property: string) {
  const berths = surfaces.get(property);
  const berth = berths?.size ? Math.max(...berths.values()) : 0;
  if (berth > 0) host.style.setProperty(property, `${Math.ceil(berth)}px`);
  else host.style.removeProperty(property);
}

/**
 * An arrival surface publishes the berth it occupies, and the map controls in
 * its lane read that berth to make room. The berth clears when the surface
 * hides, leaves the layout or unmounts.
 */
export function useMapArrivalBerth(ref: RefObject<HTMLElement | null>, { property, media, host, measure }: Berth) {
  useLayoutEffect(() => {
    const node = ref.current;
    const target = node ? host(node) : null;
    if (!node || !target || typeof window.matchMedia !== "function") return;
    const layout = window.matchMedia(media);
    const berths = surfaces.get(property) ?? new Map<HTMLElement, number>();
    surfaces.set(property, berths);
    const sync = () => {
      const berth = layout.matches && node.getClientRects().length > 0 ? measure(node) : 0;
      if (berth > 0) berths.set(node, berth);
      else berths.delete(node);
      publish(target, property);
    };
    sync();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(node);
    layout.addEventListener("change", sync);
    return () => {
      observer?.disconnect();
      layout.removeEventListener("change", sync);
      berths.delete(node);
      publish(target, property);
    };
  }, [ref, property, media, host, measure]);
}
