"use client";

import { useEffect, useMemo, useState } from "react";

import { useCommunityPrices } from "@/components/map/useCommunityPrices";
import PalQuest from "@/components/pal/PalQuest";
import { useOwnPal } from "@/components/pal/useOwnPal";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import {
  palQuestStampToday,
  readPalQuestStamps,
  stampPalQuest,
  type PalQuestStamp,
} from "@/lib/palQuest";
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

  // The Pal's price quest (lib/palQuest.ts): with the person's own Pal, the
  // first mission of a London day is the Pal's quest, and answering it lands
  // the day's stamp. A day already stamped shows the plain mission, still welcome.
  const pal = useOwnPal();
  const [stampedToday, setStampedToday] = useState<PalQuestStamp | null | undefined>(undefined);
  const [stampedNow, setStampedNow] = useState<PalQuestStamp | null>(null);
  useEffect(() => {
    queueMicrotask(() => setStampedToday(palQuestStampToday(readPalQuestStamps())));
  }, []);

  if (!enabled || !shown) return null;
  const venueName = names.get(shown.venueId) ?? "this pub";
  const questOn = pal !== null && stampedToday === null;
  return (
    <>
      {pal && (stampedNow || (questOn && !answered)) ? (
        <PalQuest
          pal={pal}
          ask={stampedNow ? null : { reason: shown.reason, venueName }}
          done={stampedNow}
        />
      ) : null}
      <PriceEvidenceMissionSlot
        mission={shown}
        venueName={venueName}
        surface="near"
        communityPrices={communityPrices}
        onDismiss={dismiss}
        onFulfilled={(current) => {
          setAnswered(current);
          complete(current);
          if (!questOn) return;
          const stamp = palQuestStampToday(
            stampPalQuest({ venueId: current.venueId, venueName: names.get(current.venueId) ?? venueName }),
          );
          setStampedNow(stamp);
          setStampedToday(stamp);
        }}
      />
    </>
  );
}
