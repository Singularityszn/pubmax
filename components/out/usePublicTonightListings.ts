"use client";

import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import { useOutListings } from "@/components/out/useOutListings";

export function usePublicTonightListings() {
  // Personalise the order after the read so both surfaces use the same capped set.
  const whatsOn = useWhatsOnTonight(true, null, { pubOnly: true, currentOnly: true });
  const out = useOutListings("tonight", undefined, { shareCurrentNight: true });
  return { whatsOn, out };
}
