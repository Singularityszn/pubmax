"use client";

import { useCallback, useEffect, useRef } from "react";

import { useSurfaceStack } from "@/lib/useSurfaceStack";
import type { SurfaceEntry } from "@/lib/surfaceStack";
import type { MapOverlay } from "@/lib/mobileShell";

/**
 * The Map's trail through its own panels.
 *
 * The Map already derives ONE value for which surface is showing
 * (`coordinatedMobileOverlay` in PubMap): a sheet, the venue detail, the
 * planner, or nothing. This hook watches that one value rather than every open
 * call site, so a new surface joins the trail by being shown, not by remembering
 * to register itself.
 *
 * Syncing works in one direction only, which is what makes Back safe. The stack
 * follows what is on screen; Back restores a parent, the Map shows it, and the
 * stack truncates to it because `openSurface` treats an id already in the trail
 * as a return. There is no second bookkeeping path to fall out of step with.
 */

/**
 * Every surface the Map can put over itself. `MapOverlay` already names the
 * sheets, the venue detail and the planner; the accessible List view is the one
 * panel outside it, and it is a place a reader can be, so it joins the trail.
 */
export type MapSurfaceId = MapOverlay | "venue-list";

/**
 * What a Map surface holds that Back has to give back. Plain and comparable, so
 * the trail records a change rather than a new object every render.
 */
export type MapSurfaceState = {
  /** The venue detail's open tab. */
  venueTab: string;
  /** The venue detail's pub id. */
  venueId: string;
  /**
   * The Area sheet's searched target, and a key naming it. The key is what the
   * trail compares, because the target itself is rebuilt on every render and a
   * reference test would record a change that never happened.
   */
  areaTargetKey: string;
  areaTarget: unknown;
  /** The Map controls sheet's open section. */
  layersTab: string;
};

export const EMPTY_MAP_SURFACE_STATE: MapSurfaceState = {
  venueTab: "",
  venueId: "",
  areaTargetKey: "",
  areaTarget: null,
  layersTab: "",
};

function sameState(a: MapSurfaceState, b: MapSurfaceState): boolean {
  return (
    a.venueTab === b.venueTab &&
    a.venueId === b.venueId &&
    a.areaTargetKey === b.areaTargetKey &&
    a.layersTab === b.layersTab
  );
}

export function useMapSurfaceTrail({
  surfaceId,
  surfaceTitle,
  surfaceState,
  onRestore,
  onHome,
}: {
  /** The surface showing now, or "none" at the Map itself. */
  surfaceId: MapSurfaceId;
  /** What the reader calls it. The Back action that returns here is named after it. */
  surfaceTitle: string;
  surfaceState: MapSurfaceState;
  /** Show `entry` again with the state it held. Null means show the Map. */
  onRestore: (entry: SurfaceEntry<MapSurfaceState> | null) => void;
  /** Leave every open surface. */
  onHome: () => void;
}) {
  const stack = useSurfaceStack<MapSurfaceState>({ onRestore, onHome });
  const { open, remember, current } = stack;
  const recordedRef = useRef<MapSurfaceState>(EMPTY_MAP_SURFACE_STATE);

  // Follow what is on screen. An id change opens (or returns to) that surface;
  // reaching the Map clears the trail.
  const shown = surfaceId === "none" ? null : surfaceId;
  const titleRef = useRef(surfaceTitle);
  const stateRef = useRef(surfaceState);
  const openedRef = useRef<MapSurfaceId | null>(null);
  const homeRef = useRef(stack.home);
  const stackHome = stack.home;
  useEffect(() => {
    titleRef.current = surfaceTitle;
    stateRef.current = surfaceState;
    homeRef.current = stackHome;
  }, [stackHome, surfaceState, surfaceTitle]);

  useEffect(() => {
    if (openedRef.current === shown) return;
    openedRef.current = shown;
    if (!shown) {
      // The Map itself. Clearing through the stack's own home keeps the browser
      // history in step, so a later back gesture does not walk closed sheets.
      homeRef.current();
      return;
    }
    recordedRef.current = stateRef.current;
    // The venue detail already has a history entry: useMapSelectionHistory owns
    // `sel` and pops it on Back. Pushing a second one here would make the
    // reader press Back twice to leave one pub.
    open(
      { id: shown, title: titleRef.current, state: stateRef.current },
      { pushHistory: shown !== "venue" },
    );
  }, [open, shown]);

  // Keep the current surface's snapshot live, so Back restores what the reader
  // actually left rather than how the surface opened.
  useEffect(() => {
    // Same guard as the title effect below: only the surface actually showing
    // may write its state into the trail.
    if (!current || current.id !== shown) return;
    if (sameState(recordedRef.current, surfaceState)) return;
    recordedRef.current = surfaceState;
    remember(surfaceState);
  }, [current, remember, shown, surfaceState]);

  // A title that resolves late (a pub's name arriving with its detail) must
  // reach the entry, or Back would offer to return to "Pub detail".
  //
  // The id guard is load-bearing. For one render after a new surface opens,
  // `current` is still the surface BELOW it while `surfaceTitle` already names
  // the new one. Renaming on that render retitled the parent, and because
  // openSurface treats a known id as a return it truncated the trail back to
  // it — so the surface the reader had just opened lost its Back.
  useEffect(() => {
    if (!current || current.id !== shown || current.title === surfaceTitle) return;
    open({ id: current.id, title: surfaceTitle, state: current.state ?? EMPTY_MAP_SURFACE_STATE });
  }, [current, open, shown, surfaceTitle]);

  const back = stack.back;
  const home = stack.home;
  return {
    backLabel: stack.backLabel,
    back: useCallback(() => back(), [back]),
    home: useCallback(() => home(), [home]),
    depth: stack.depth,
  };
}
