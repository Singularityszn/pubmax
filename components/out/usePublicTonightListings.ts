"use client";

import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import { useOutListings } from "@/components/out/useOutListings";
import type { LatLngPoint } from "@/lib/geo";

export function usePublicTonightListings(near: LatLngPoint | null = null) {
  const whatsOn = useWhatsOnTonight(true, near, { pubOnly: true, currentOnly: true });
  const out = useOutListings("tonight", undefined, { shareCurrentNight: true });
  return { whatsOn, out };
}
