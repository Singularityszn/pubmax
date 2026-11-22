"use client";

import { useEffect, type ComponentProps } from "react";

import { lazyPanel } from "@/components/map/lazyPanel";
import type { ChooseAreaDesktopDialog as Dialog } from "@/components/map/ChooseAreaSheet";
import type { LandmarkStoryHead as StoryHead } from "@/components/map/LandmarkStoryBody";

// Surfaces the map's first frame never draws. Each stays out of the map's
// critical chunk and is warmed once the pins have painted, so the first tap
// that opens one finds it ready. A tap before then fetches it on demand.

export const MobileLayersPanel = lazyPanel(
  () => import("@/components/map/pubmap/MobileLayersPanel"),
  "Map controls did not open. Check your signal.",
);

export const ChooseAreaSheet = lazyPanel(
  () => import("@/components/map/ChooseAreaSheet"),
  "Areas did not open. Check your signal.",
);

export const ChooseAreaDesktopDialog = lazyPanel<ComponentProps<typeof Dialog>>(
  () => import("@/components/map/ChooseAreaSheet").then((m) => ({ default: m.ChooseAreaDesktopDialog })),
  "Areas did not open. Check your signal.",
);

export const LandmarkStoryBody = lazyPanel(
  () => import("@/components/map/LandmarkStoryBody"),
  "The story did not open. Check your signal.",
);

export const LandmarkStoryHead = lazyPanel<ComponentProps<typeof StoryHead>>(
  () => import("@/components/map/LandmarkStoryBody").then((m) => ({ default: m.LandmarkStoryHead })),
  "The story did not open. Check your signal.",
);

const DEFERRED_MAP_SURFACES = [
  MobileLayersPanel,
  ChooseAreaSheet,
  ChooseAreaDesktopDialog,
  LandmarkStoryBody,
  LandmarkStoryHead,
];

/** Warms every deferred surface in the first idle moment after the pins paint. */
export function useWarmDeferredMapSurfaces(secondaryStreamsHeld: boolean): void {
  useEffect(() => {
    if (secondaryStreamsHeld) return;
    const warm = () => {
      for (const surface of DEFERRED_MAP_SURFACES) void surface.warm();
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 2_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(warm, 0);
    return () => window.clearTimeout(handle);
  }, [secondaryStreamsHeld]);
}
