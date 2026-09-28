"use client";

import nextDynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { analyticsCollectionAllowed } from "@/lib/analytics";

import { shouldMountVercelAnalytics } from "@/components/ConsentAwareVercelAnalytics";

const DeferredSpeedInsights = nextDynamic(
  () => import("@vercel/speed-insights/next").then((mod) => mod.SpeedInsights),
  { ssr: false },
);

export type SpeedInsightsBeforeSendEvent = {
  type: "vital";
  url: string;
  route?: string;
};

/** Vercel Speed Insights vitals stay disabled until explicit analytics consent. */
export function consentAwareSpeedInsightsBeforeSend(
  event: SpeedInsightsBeforeSendEvent,
): SpeedInsightsBeforeSendEvent | null {
  return analyticsCollectionAllowed() ? event : null;
}

const IDLE_TIMEOUT_MS = 3_000;

function useIdleOrInteractionReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      setReady(true);
    };

    const listenerOptions: AddEventListenerOptions = { once: true, passive: true };
    window.addEventListener("pointerdown", release, listenerOptions);
    window.addEventListener("keydown", release, listenerOptions);

    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestIdleCallback === "function") {
      idleHandle = requestIdleCallback(release, { timeout: IDLE_TIMEOUT_MS });
    } else {
      timeoutHandle = setTimeout(release, IDLE_TIMEOUT_MS);
    }

    return () => {
      window.removeEventListener("pointerdown", release, listenerOptions);
      window.removeEventListener("keydown", release, listenerOptions);
      if (idleHandle !== undefined && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    };
  }, [ready]);

  return ready;
}

/** Speed Insights on Vercel only, consent-gated, after idle or first interaction. */
export default function ConsentAwareVercelSpeedInsights() {
  const idleOrInteraction = useIdleOrInteractionReady();
  if (!shouldMountVercelAnalytics(process.env.NODE_ENV, process.env.VERCEL)) return null;
  if (!idleOrInteraction) return null;
  return (
    <DeferredSpeedInsights beforeSend={consentAwareSpeedInsightsBeforeSend} />
  );
}
