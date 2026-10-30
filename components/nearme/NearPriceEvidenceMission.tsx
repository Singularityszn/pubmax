"use client";

import { useEffect, useMemo, useState } from "react";

import { useCommunityPrices } from "@/components/map/useCommunityPrices";
import PalQuest from "@/components/pal/PalQuest";
import { useOwnPal } from "@/components/pal/useOwnPal";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import {
  PAL_QUEST_STAMPS_KEY,
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
  const areas = useMemo(
    () => new Map(cards.map((card) => [card.id, card.borough])),
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
  // The Pal's price quest (lib/palQuest.ts): with the person's own Pal, the
  // first mission of a London day is the Pal's quest, and answering it lands
  // the day's stamp. A day already stamped shows the plain mission, still welcome.
  // The quest state belongs to the Pal's owner: an account switch starts it
  // afresh, and the book is read again when another tab changes it.
  const pal = useOwnPal();
  const owner = pal ? `${pal.ownerId}:${pal.id}` : "";
  const [answeredBy, setAnswered] = useState<{ owner: string; mission: PriceEvidenceMission } | null>(null);
  const answered = answeredBy && answeredBy.owner === owner ? answeredBy.mission : null;
  const shown = mission ?? answered;

  const [quest, setQuest] = useState<{
    owner: string;
    /** Today's stamp, or null for none yet; undefined until the book is read. */
    today: PalQuestStamp | null | undefined;
    /** The stamp this answer just landed, shown with the Pal's cheer. */
    now: PalQuestStamp | null;
  }>({ owner: "", today: undefined, now: null });
  useEffect(() => {
    const read = () =>
      setQuest((held) => ({
        owner,
        today: palQuestStampToday(readPalQuestStamps()),
        now: held.owner === owner ? held.now : null,
      }));
    queueMicrotask(read);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PAL_QUEST_STAMPS_KEY) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [owner]);
  const current = quest.owner === owner ? quest : { owner, today: undefined, now: null };

  if (!enabled || !shown) return null;
  const venueName = names.get(shown.venueId) ?? "this pub";
  const questOn = pal !== null && current.today === null;
  const stampedNow = current.now;
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
        onFulfilled={(answer) => {
          setAnswered({ owner, mission: answer });
          complete(answer);
          if (!questOn) return;
          // Only a stamp this answer added is shown as its own: a day another
          // tab stamped meanwhile ends the quest without claiming that pub.
          const added = stampPalQuest({
            venueId: answer.venueId,
            venueName: names.get(answer.venueId) ?? venueName,
            area: areas.get(answer.venueId),
          });
          setQuest({ owner, today: palQuestStampToday(readPalQuestStamps()), now: added });
        }}
      />
    </>
  );
}
