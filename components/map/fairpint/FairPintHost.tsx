"use client";

import type { fairPence } from "@/lib/fairPintPricing";
import FairPintGate from "./FairPintGate";
import { MapConnection, type Bridge } from "./FairPintBridge";
import { dismissMapFirstVisitArrival } from "@/lib/mapFirstVisitArrival";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clearEarlyFairPint, setFairPintSession, supportsFairPint } from "@/lib/fairPint";
import { MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, suppressMapFirstVisitPrompts } from "@/lib/mapFirstVisitArrivalGate";
import { getCity, type CityId } from "@/lib/cities";
import { boundsForOpeningView } from "@/lib/mapOpeningBounds";

export function FairPintHost({ children, cityId, priceReader }: { children: ReactNode; cityId: CityId; priceReader: typeof fairPence }) {
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const queued = useRef<{ pounds?: number; route?: Parameters<Bridge["onRoute"]> }>({});
  const commit = useCallback((pounds: number) => {
    if (bridge) bridge.onCommit(pounds);
    else queued.current.pounds = pounds;
  }, [bridge]);
  useEffect(() => {
    if (!supportsFairPint(cityId)) {
      if (!window.__pubmaxEarlyFairPint?.closed) clearEarlyFairPint();
      setFairPintSession(false);
      return;
    }
    const update = () => {
      const early = window.__pubmaxEarlyFairPint;
      if (!early) return;
      const pending = early.releases - (early.handledReleases ?? 0);
      if (pending > 0) {
        early.handledReleases = early.releases;
        commit((early.committedPence ?? early.pence) / 100);
        void import("@/lib/nativeHaptics").then(({ haptic }) => {
          for (let index = 0; index < pending; index++) void haptic("selection-kept");
        }).catch(() => {});
      }
      setFairPintSession(!early.closed, early.pence);
      if (early.closed) {
        early.location = undefined;
        clearEarlyFairPint();
        dismissMapFirstVisitArrival(undefined, Date.now(), true);
        suppressMapFirstVisitPrompts();
      }
    };
    update();
    window.addEventListener(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, update);
    return () => window.removeEventListener(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, update);
  }, [commit, cityId]);
  useEffect(() => () => {
    if (!window.__pubmaxEarlyFairPint?.closed) clearEarlyFairPint();
    setFairPintSession(false);
  }, []);
  const [gateReady, setGateReady] = useState(false);
  useEffect(() => {
    if (gateReady || !supportsFairPint(cityId)) return;
    let idle: number | undefined, timer: number | undefined;
    const load = () => {
      idle = undefined;
      timer = undefined;
      const early = window.__pubmaxEarlyFairPint;
      if (!early?.dragging && !early?.closed) setGateReady(true);
    };
    const schedule = () => {
      const early = window.__pubmaxEarlyFairPint;
      if (idle !== undefined || timer !== undefined || early?.dragging || early?.closed) return;
      if (typeof requestIdleCallback === "function") idle = requestIdleCallback(load, { timeout: 300 });
      else timer = window.setTimeout(load, 0);
    };
    schedule();
    window.addEventListener(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, schedule);
    return () => {
      if (idle !== undefined) cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, schedule);
    };
  }, [gateReady, cityId]);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width: 640px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!bridge) return;
    if (queued.current.pounds !== undefined) bridge.onCommit(queued.current.pounds);
    if (queued.current.route) bridge.onRoute(...queued.current.route);
    queued.current = {};
  }, [bridge]);
  const view = getCity(cityId).mapView;
  const bounds = bridge?.bounds ?? boundsForOpeningView(view);
  return (
    <MapConnection.Provider value={setBridge}>
      {children}
      {gateReady && supportsFairPint(cityId) ? (
        <FairPintGate
          priceReader={priceReader}
          cityId={cityId}
          readerPosition={bridge?.position ?? null}
          mobile={mobile}
          bounds={bounds}
          center={bridge?.center ?? view.center}
          onCommit={commit}
          onRoute={(...route) => {
            if (bridge) bridge.onRoute(...route);
            else queued.current.route = route;
          }}
        />
      ) : null}
    </MapConnection.Provider>
  );
}
