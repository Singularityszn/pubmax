"use client";

import { useMemo, useState } from "react";

import { useCommunityPrices } from "@/components/map/useCommunityPrices";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import type { PriceEvidenceMission } from "@/lib/priceEvidenceMissions";

import PriceEvidenceMissionSlot from "./PriceEvidenceMissionSlot";
import { usePriceEvidenceMission } from "./usePriceEvidenceMission";

export default function NearPriceEvidenceMission({
  cards,
  enabled,
}: {
  cards: readonly NearMeCard[];
  enabled: boolean;
}) {
  const venueIds = useMemo(() => cards.map((card) => card.id), [cards]);
  const names = useMemo(
    () => new Map(cards.map((card) => [card.id, card.name])),
    [cards],
  );
  const communityPrices = useCommunityPrices();
  const { mission, dismiss, complete } = usePriceEvidenceMission({
    venueIds,
    enabled,
    surface: "near",
  });
  // A logged price answers the mission, and the read then stops offering this
  // pub, but the RECEIPT is inside the slot. So the answered mission is held
  // here and keeps its own slot on screen; the slot drops the ask itself.
  const [answered, setAnswered] = useState<PriceEvidenceMission | null>(null);
  const shown = mission ?? answered;

  if (!enabled || !shown) return null;
  const venueName = names.get(shown.venueId) ?? "this pub";
  return (
    <PriceEvidenceMissionSlot
      mission={shown}
      venueName={venueName}
      surface="near"
      communityPrices={communityPrices}
      onDismiss={dismiss}
      onFulfilled={(current) => {
        setAnswered(current);
        complete(current);
      }}
    />
  );
}
