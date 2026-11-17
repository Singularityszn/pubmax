"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, suppressMapFirstVisitPrompts } from "@/lib/mapFirstVisitArrivalGate";
import FairPintFlow from "./FairPintFlow";
import {
  fairPintActive,
  subscribeFairPintActive,
  supportsFairPint,
  earlyFairPintClosed,
  earlyFairPintDragging,
  setFairPintSession,
  clearEarlyFairPint,
} from "@/lib/fairPint";
import { getCity, type CityId } from "@/lib/cities";
import {
  shouldShowMapFirstVisitArrival,
  subscribeMapFirstVisitArrival,
  dismissMapFirstVisitArrival,
} from "@/lib/mapFirstVisitArrival";
import type { MapBounds } from "@/lib/slimShards";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { NightAreaSlug } from "@/lib/nightAreas";

type Bridge = {
  bounds: MapBounds;
  center: [number, number];
  position?: { lat: number; lng: number } | null;
  onCommit: (pounds: number) => void;
  onRoute: (area: NightAreaSlug | null, ids: string[], rows: SlimVenue[]) => void;
};
const MapConnection = createContext<(value: Bridge | null) => void>(() => {});

export function FairPintMapBridge(props: Bridge) {
  const publish = useContext(MapConnection);
  const current = useRef(props);
  useLayoutEffect(() => {
    current.current = props;
  });
  const actions = useMemo(
    () => ({
      onCommit: (pounds: number) => current.current.onCommit(pounds),
      onRoute: (area: NightAreaSlug | null, ids: string[], rows: SlimVenue[]) =>
        current.current.onRoute(area, ids, rows),
    }),
    [],
  );
  const { west, south, east, north } = props.bounds;
  const [lng, lat] = props.center;
  useEffect(() => {
    publish({ bounds: { west, south, east, north }, center: [lng, lat], position: props.position ?? null, ...actions });
  }, [publish, actions, west, south, east, north, lng, lat, props.position]);
  useEffect(() => () => publish(null), [publish]);
  return null;
}

export function FairPintHost({ children, cityId }: { children: ReactNode; cityId: CityId }) {
  useEffect(() => {
    const update = () => {
      const early = window.__pubmaxEarlyFairPint;
      if (!early) return;
      if (early.closed) {
        clearEarlyFairPint();
        suppressMapFirstVisitPrompts();
        setFairPintSession(false);
        dismissMapFirstVisitArrival(undefined, Date.now(), true);
      } else setFairPintSession(true, early.pence);
    };
    update();
    window.addEventListener(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, update);
    return () => {
      window.removeEventListener(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, update);
      setFairPintSession(false);
    };
  }, []);
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const queued = useRef<{ pounds?: number; route?: Parameters<Bridge["onRoute"]> }>({});
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width: 640px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const eligible = useSyncExternalStore(
    subscribeMapFirstVisitArrival,
    () =>
      !earlyFairPintClosed() &&
      !earlyFairPintDragging() &&
      supportsFairPint(cityId) &&
      shouldShowMapFirstVisitArrival({ pinsRevealed: true, search: location.search }),
    () => false,
  );
  const active = useSyncExternalStore(subscribeFairPintActive, fairPintActive, () => false);
  useEffect(() => {
    if (!bridge) return;
    if (queued.current.pounds !== undefined) bridge.onCommit(queued.current.pounds);
    if (queued.current.route) bridge.onRoute(...queued.current.route);
    queued.current = {};
  }, [bridge]);
  const view = getCity(cityId).mapView;
  const width = typeof window === "undefined" ? 390 : innerWidth;
  const height = typeof window === "undefined" ? 844 : innerHeight;
  const dx = (width * 180) / (512 * 2 ** view.zoom);
  const dy = (height * 180 * 1.4) / (512 * 2 ** view.zoom);
  const bounds = bridge?.bounds ?? {
    west: view.center[0] - dx,
    east: view.center[0] + dx,
    south: view.center[1] - dy,
    north: view.center[1] + dy,
  };
  return (
    <MapConnection.Provider value={setBridge}>
      {children}
      {supportsFairPint(cityId) && !earlyFairPintDragging() && (eligible || active) ? (
        <FairPintFlow
          cityId={cityId}
          readerPosition={bridge?.position ?? null}
          mobile={mobile}
          bounds={bounds}
          center={bridge?.center ?? view.center}
          onCommit={(pounds) => {
            if (bridge) bridge.onCommit(pounds);
            else queued.current.pounds = pounds;
          }}
          onRoute={(...route) => {
            if (bridge) bridge.onRoute(...route);
            else queued.current.route = route;
          }}
        />
      ) : null}
    </MapConnection.Provider>
  );
}
