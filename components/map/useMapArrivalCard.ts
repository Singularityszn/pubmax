"use client";

import { fairPintActive, subscribeFairPintActive } from "@/lib/fairPint";
import { useState, useSyncExternalStore } from "react";

import { useMapReaderPosition } from "@/components/map/useMapReaderPosition";
import {
  shouldShowMapArrivalLocationCard,
  shouldShowMapFirstVisitArrival,
  subscribeMapFirstVisitArrival,
} from "@/lib/mapFirstVisitArrival";

export function useMapArrivalCard({
  mobile,
  cityId,
  onLocationExposure,
  pinsRevealed,
  recoveryToastActive,
  search,
}: {
  mobile: boolean;
  cityId: string;
  onLocationExposure: () => void;
  pinsRevealed: boolean;
  recoveryToastActive: boolean;
  search: string;
}) {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const eligible = useSyncExternalStore(
    subscribeMapFirstVisitArrival,
    () =>
      shouldShowMapFirstVisitArrival({
        pinsRevealed: cityId === "london" || pinsRevealed,
        search,
        recoveryToastActive,
      }),
    () => false,
  );
  const readerPosition = useMapReaderPosition(onLocationExposure, setPermission);
  const active = useSyncExternalStore(subscribeFairPintActive, fairPintActive, () => false);
  const visible = cityId === "london" ? eligible || active : shouldShowMapArrivalLocationCard({
    eligible,
    mobile,
    permission,
    hasPosition: readerPosition !== null,
  });

  return { readerPosition, visible };
}
