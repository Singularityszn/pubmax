import { useCallback, type RefObject } from "react";

import { currentCameraRequestToken, isLatestCameraRequest, nextCameraRequestToken } from "@/lib/cameraIntent";
import type { CityId } from "@/lib/cities";
import { writeMapChosenArea } from "@/lib/mapChosenArea";
import { latchMapReaderLocationWatch } from "@/lib/mapReaderPosition";
import { NEAR_ME_LOCATION_OPTIONS, nearMeLocationFailure, nearMeLocationMessage } from "@/lib/nearMeLocation";

type UserLocation = { lat: number; lng: number };
type NearMeMode = "tap" | "arrival" | "resume";
export type PendingNearMeRequest = { location: UserLocation; requestToken: number } & (
  | { kind: "map"; mode: NearMeMode }
  | { kind: "crawl"; stopCount: number }
);

export function useNearMeRequests({
  cityId, stopCount, invalidatePrivateCamera, setNearbyError, setNearbyLoading,
  setUserLocation, setNearbyRequestToken, setPendingNearMeRequest, openChooseAreaRef,
}: {
  cityId: CityId;
  stopCount: number;
  invalidatePrivateCamera: () => void;
  setNearbyError: (error: string | null) => void;
  setNearbyLoading: (loading: boolean) => void;
  setUserLocation: (location: UserLocation) => void;
  setNearbyRequestToken: (token: number) => void;
  setPendingNearMeRequest: (request: PendingNearMeRequest) => void;
  openChooseAreaRef: RefObject<(note?: string | null, openingFlow?: boolean) => void>;
}) {
  const startNearbyCrawl = useCallback(() => {
    const requestToken = nextCameraRequestToken();
    setNearbyError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNearbyError(nearMeLocationMessage("unsupported"));
      return;
    }
    invalidatePrivateCamera();
    setNearbyLoading(true);
    navigator.geolocation.getCurrentPosition((position) => {
      if (!isLatestCameraRequest(requestToken)) return;
      const location = { lat: position.coords.latitude, lng: position.coords.longitude };
      setUserLocation(location);
      latchMapReaderLocationWatch();
      invalidatePrivateCamera();
      setPendingNearMeRequest({ kind: "crawl", location, stopCount, requestToken });
    }, (error) => {
      if (!isLatestCameraRequest(requestToken)) return;
      setNearbyLoading(false);
      setNearbyError(nearMeLocationMessage(nearMeLocationFailure(error)));
    }, NEAR_ME_LOCATION_OPTIONS);
  }, [stopCount, invalidatePrivateCamera, setNearbyError, setNearbyLoading, setPendingNearMeRequest, setUserLocation]);

  const runNearMe = useCallback((mode: NearMeMode) => {
    const requestToken = mode === "resume" ? currentCameraRequestToken() : nextCameraRequestToken();
    setNearbyError(null);
    const refuse = (message: string) => {
      if (mode === "resume") return;
      if (mode === "arrival") {
        openChooseAreaRef.current(message, true);
        return;
      }
      setNearbyError(message);
    };
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      refuse(nearMeLocationMessage("unsupported"));
      return;
    }
    invalidatePrivateCamera();
    setNearbyLoading(true);
    navigator.geolocation.getCurrentPosition((position) => {
      if (!isLatestCameraRequest(requestToken)) return;
      const location = { lat: position.coords.latitude, lng: position.coords.longitude };
      setUserLocation(location);
      if (mode !== "resume") setNearbyRequestToken(requestToken);
      latchMapReaderLocationWatch();
      invalidatePrivateCamera();
      setPendingNearMeRequest({ kind: "map", location, mode, requestToken });
      writeMapChosenArea({ cityId, label: "Near me", slug: "near-me", kind: "near-me" });
    }, (error) => {
      if (!isLatestCameraRequest(requestToken)) return;
      setNearbyLoading(false);
      refuse(nearMeLocationMessage(nearMeLocationFailure(error)));
    }, NEAR_ME_LOCATION_OPTIONS);
  }, [cityId, invalidatePrivateCamera, setNearbyError, setNearbyLoading, setNearbyRequestToken, setPendingNearMeRequest, setUserLocation, openChooseAreaRef]);
  return { startNearbyCrawl, runNearMe };
}
