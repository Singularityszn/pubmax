"use client";

import { useEffect, useSyncExternalStore, type ComponentProps } from "react";
import FairPintFlow from "./FairPintFlow";
import { MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT, suppressMapFirstVisitPrompts } from "@/lib/mapFirstVisitArrivalGate";
import {
  fairPintActive,
  subscribeFairPintActive,
  supportsFairPint,
  earlyFairPintClosed,
  earlyFairPintDragging,
  setFairPintSession,
  clearEarlyFairPint,
} from "@/lib/fairPint";
import {
  shouldShowMapFirstVisitArrival,
  subscribeMapFirstVisitArrival,
  dismissMapFirstVisitArrival,
} from "@/lib/mapFirstVisitArrival";

export default function FairPintGate(props: ComponentProps<typeof FairPintFlow>) {
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
  const eligible = useSyncExternalStore(
    subscribeMapFirstVisitArrival,
    () =>
      !earlyFairPintClosed() &&
      !earlyFairPintDragging() &&
      supportsFairPint(props.cityId) &&
      shouldShowMapFirstVisitArrival({ pinsRevealed: true, search: location.search }),
    () => false,
  );
  const active = useSyncExternalStore(subscribeFairPintActive, fairPintActive, () => false);
  return !earlyFairPintDragging() && (eligible || active) ? <FairPintFlow {...props} /> : null;
}
