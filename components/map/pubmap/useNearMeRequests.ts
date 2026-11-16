import { useCallback, useRef, type RefObject } from "react";

import { currentCameraRequestToken, isLatestCameraRequest, nextCameraRequestToken } from "@/lib/cameraIntent";
import type { CityId } from "@/lib/cities";
import { writeMapChosenArea } from "@/lib/mapChosenArea";
import { latchMapReaderLocationWatch } from "@/lib/mapReaderPosition";
import { NEAR_ME_LOCATION_OPTIONS, nearMeLocationFailure, nearMeLocationMessage } from "@/lib/nearMeLocation";

type UserLocation = { lat: number; lng: number };
type NearMeMode = "tap" | "arrival" | "resume";
type NearMeRequest = { requestToken: number; isCurrent: () => boolean; finish: () => void };
export type PendingNearMeRequest = NearMeRequest & { location: UserLocation } & (
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
  setPendingNearMeRequest: (request: PendingNearMeRequest | null) => void;
  openChooseAreaRef: RefObject<(note?: string | null, openingFlow?: boolean) => void>;
}) {
  const activeRequest = useRef<NearMeRequest | null>(null);
  const beginRequest = useCallback((requestToken: number) => {
    const request: NearMeRequest = {
      requestToken,
      isCurrent: () => {
        if (activeRequest.current !== request) return false;
        if (isLatestCameraRequest(requestToken)) return true;
        request.finish();
        return false;
      },
      finish: () => {
        if (activeRequest.current !== request) return;
        activeRequest.current = null;
        setNearbyLoading(false);
        setPendingNearMeRequest(null);
      },
    };
    activeRequest.current = request;
    setPendingNearMeRequest(null);
    setNearbyError(null);
    setNearbyLoading(true);
    return request;
  }, [setNearbyError, setNearbyLoading, setPendingNearMeRequest]);

  const startNearbyCrawl = useCallback(() => {
    const request = beginRequest(nextCameraRequestToken());
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      request.finish();
      setNearbyError(nearMeLocationMessage("unsupported"));
      return;
    }
    invalidatePrivateCamera();
    navigator.geolocation.getCurrentPosition((position) => {
      if (!request.isCurrent()) return;
      const location = { lat: position.coords.latitude, lng: position.coords.longitude };
      setUserLocation(location);
      latchMapReaderLocationWatch();
      invalidatePrivateCamera();
      setPendingNearMeRequest({ ...request, kind: "crawl", location, stopCount });
    }, (error) => {
      if (!request.isCurrent()) return;
      request.finish();
      setNearbyError(nearMeLocationMessage(nearMeLocationFailure(error)));
    }, NEAR_ME_LOCATION_OPTIONS);
  }, [stopCount, beginRequest, invalidatePrivateCamera, setNearbyError, setPendingNearMeRequest, setUserLocation]);

  const runNearMe = useCallback((mode: NearMeMode) => {
    const request = beginRequest(mode === "resume" ? currentCameraRequestToken() : nextCameraRequestToken());
    const refuse = (message: string) => {
      if (mode === "resume") return;
      if (mode === "arrival") {
        openChooseAreaRef.current(message, true);
        return;
      }
      setNearbyError(message);
    };
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      request.finish();
      refuse(nearMeLocationMessage("unsupported"));
      return;
    }
    invalidatePrivateCamera();
    navigator.geolocation.getCurrentPosition((position) => {
      if (!request.isCurrent()) return;
      const location = { lat: position.coords.latitude, lng: position.coords.longitude };
      setUserLocation(location);
      if (mode !== "resume") setNearbyRequestToken(request.requestToken);
      latchMapReaderLocationWatch();
      invalidatePrivateCamera();
      setPendingNearMeRequest({ ...request, kind: "map", location, mode });
      writeMapChosenArea({ cityId, label: "Near me", slug: "near-me", kind: "near-me" });
    }, (error) => {
      if (!request.isCurrent()) return;
      request.finish();
      refuse(nearMeLocationMessage(nearMeLocationFailure(error)));
    }, NEAR_ME_LOCATION_OPTIONS);
  }, [cityId, beginRequest, invalidatePrivateCamera, setNearbyError, setNearbyRequestToken, setPendingNearMeRequest, setUserLocation, openChooseAreaRef]);
  return { startNearbyCrawl, runNearMe };
}
