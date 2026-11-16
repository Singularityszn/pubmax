"use client";

import { useState, useSyncExternalStore } from "react";

import { useMapReaderPosition } from "@/components/map/useMapReaderPosition";
import {
  shouldShowMapArrivalLocationCard,
  shouldShowMapFirstVisitArrival,
  subscribeMapFirstVisitArrival,
} from "@/lib/mapFirstVisitArrival";

export function useMapArrivalCard({
  mobile,
  onLocationExposure,
  pinsRevealed,
  recoveryToastActive,
  search,
}: {
  mobile: boolean;
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
        pinsRevealed,
        search,
        recoveryToastActive,
      }),
    () => false,
  );
  const readerPosition = useMapReaderPosition(onLocationExposure, setPermission);
  const visible = shouldShowMapArrivalLocationCard({
    eligible,
    mobile,
    permission,
    hasPosition: readerPosition !== null,
  });

  return { readerPosition, visible };
}
