"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useCommunityPrices } from "@/components/map/useCommunityPrices";
import { trackEvent } from "@/lib/analytics";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import {
  missionAnalyticsProps,
  priceEvidenceMissionKey,
  type PriceEvidenceMission,
} from "@/lib/priceEvidenceMissions";

import PriceEvidenceMissionSlot from "./PriceEvidenceMissionSlot";
import { usePriceEvidenceMission } from "./usePriceEvidenceMission";

type HeldMission = {
  mission: PriceEvidenceMission;
  venueName: string;
};

type CompletedMission = HeldMission & {
  scopeKey: string;
};

export default function NearPriceEvidenceMission({
  cards,
  enabled,
}: {
  cards: readonly NearMeCard[];
  enabled: boolean;
}) {
  const venueIds = useMemo(() => cards.map((card) => card.id), [cards]);
  const scopeKey = useMemo(() => JSON.stringify(venueIds), [venueIds]);
  const scopeKeyRef = useRef(scopeKey);
  useLayoutEffect(() => {
    scopeKeyRef.current = scopeKey;
  }, [scopeKey]);
  const activeMissionKeyRef = useRef<string | null>(null);
  const viewedMissionKeyRef = useRef<string | null>(null);
  const names = useMemo(
    () => new Map(cards.map((card) => [card.id, card.name])),
    [cards],
  );
  const communityPrices = useCommunityPrices();
  const [heldMission, setHeldMission] = useState<HeldMission | null>(null);
  const [completedMission, setCompletedMission] =
    useState<CompletedMission | null>(null);
  const { mission, dismiss, complete } = usePriceEvidenceMission({
    venueIds,
    enabled,
    surface: "near",
    trackViewed: false,
  });

  const currentCompletion = completedMission?.scopeKey === scopeKey
    ? completedMission
    : null;
  useEffect(() => {
    if (!completedMission || completedMission.scopeKey === scopeKey) return;
    // Once results move on, an earned receipt must not reappear if the old
    // result set returns later in this mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompletedMission(null);
  }, [completedMission, scopeKey]);
  useEffect(() => {
    if (enabled) return;
    // Disabling the surface ends any open task and its transient receipt.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeldMission(null);
    setCompletedMission(null);
  }, [enabled]);

  const displayedMission = currentCompletion?.mission ?? heldMission?.mission ?? mission;
  useEffect(() => {
    if (!displayedMission || currentCompletion) return;
    const key = priceEvidenceMissionKey(displayedMission);
    if (viewedMissionKeyRef.current === key) return;
    viewedMissionKeyRef.current = key;
    trackEvent(
      "mission_viewed",
      missionAnalyticsProps("near", displayedMission),
    );
  }, [currentCompletion, displayedMission]);
  if (!enabled || !displayedMission) return null;
  const venueName = currentCompletion?.venueName ?? heldMission?.venueName ??
    names.get(displayedMission.venueId) ?? "this pub";
  return (
    <PriceEvidenceMissionSlot
      key={priceEvidenceMissionKey(displayedMission)}
      mission={displayedMission}
      venueName={venueName}
      surface="near"
      communityPrices={communityPrices}
      onDismiss={(current) => {
        activeMissionKeyRef.current = null;
        setHeldMission(null);
        setCompletedMission(null);
        dismiss(current);
      }}
      onOpen={(current) => {
        activeMissionKeyRef.current = priceEvidenceMissionKey(current);
        setHeldMission({ mission: current, venueName });
      }}
      resolved={currentCompletion !== null}
      onComplete={(current) => {
        if (activeMissionKeyRef.current !== priceEvidenceMissionKey(current)) {
          return;
        }
        activeMissionKeyRef.current = null;
        setHeldMission(null);
        // The submit callback can finish after cards rerank. Read current scope
        // from the ref so the receipt survives that in-flight transition.
        setCompletedMission({
          mission: current,
          venueName,
          scopeKey: scopeKeyRef.current,
        });
        complete(current);
      }}
    />
  );
}
