"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import FairPintFlow from "./FairPintFlow";
import {
  fairPintActive,
  subscribeFairPintActive,
  earlyFairPintClosed,
  earlyFairPintDragging,
  fairPintSearchSuppresses,
} from "@/lib/fairPint";
import {
  shouldShowMapFirstVisitArrival,
  subscribeMapFirstVisitArrival,
} from "@/lib/mapFirstVisitArrival";

export default function FairPintGate(props: ComponentProps<typeof FairPintFlow>) {
  const eligible = useSyncExternalStore(
    subscribeMapFirstVisitArrival,
    () =>
      !earlyFairPintClosed() &&
      !earlyFairPintDragging() &&
      !fairPintSearchSuppresses(location.search) && shouldShowMapFirstVisitArrival({ pinsRevealed: true, search: "" }),
    () => false,
  );
  const active = useSyncExternalStore(subscribeFairPintActive, fairPintActive, () => false);
  return !earlyFairPintDragging() && (eligible || active) ? <FairPintFlow {...props} /> : null;
}
