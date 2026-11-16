import { useEffect, useEffectEvent, useRef, type RefObject } from "react";

import { nextCameraRequestToken } from "@/lib/cameraIntent";
import { isMapSearchField, TYPED_SEARCH_MIN_QUERY, typedSearchCameraMove } from "@/lib/mapSearchCamera";
import type { Venue } from "@/lib/venues";

export function useTypedSearchCamera({
  disabled, query, searchFieldFocused, searchOverlayOpen, venuesRef, ownedQueryRef,
  selectVenue, setSearchRecoveryToken, setNearbyMapResult,
}: {
  disabled: boolean;
  query: string;
  searchFieldFocused: boolean;
  searchOverlayOpen: boolean;
  venuesRef: RefObject<Venue[]>;
  ownedQueryRef: RefObject<string | null>;
  selectVenue: (id: string, tab: "overview", requestToken: number) => void;
  setSearchRecoveryToken: (token: number) => void;
  setNearbyMapResult: (value: null) => void;
}) {
  const moveSearch = useEffectEvent((requestQuery: string, requestToken: number) => {
    const move = typedSearchCameraMove({
      query: requestQuery,
      matchCount: venuesRef.current.length,
      searchFieldFocused: isMapSearchField(document.activeElement),
      cameraOwnedByPick: ownedQueryRef.current === requestQuery,
    });
    if (move !== "none") setNearbyMapResult(null);
    if (move === "select-one") {
      const [match] = venuesRef.current;
      if (match) selectVenue(match.id, "overview", requestToken);
    } else if (move === "fit-many") {
      setSearchRecoveryToken(requestToken);
    }
  });
  const didMountRef = useRef(false);
  useEffect(() => {
    if (disabled) return;
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (searchFieldFocused || searchOverlayOpen || query.length < TYPED_SEARCH_MIN_QUERY) return;
    const requestToken = nextCameraRequestToken();
    const handle = window.setTimeout(() => moveSearch(query, requestToken), 320);
    return () => window.clearTimeout(handle);
  }, [disabled, query, searchFieldFocused, searchOverlayOpen]);
}
