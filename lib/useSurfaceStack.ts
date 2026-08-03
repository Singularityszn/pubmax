"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ROOT_SURFACE_STACK,
  backActionLabel,
  backSurface,
  canGoBack,
  currentSurface,
  homeSurface,
  openSurface,
  parentSurface,
  rememberSurfaceState,
  surfaceDepth,
  type SurfaceEntry,
  type SurfaceStack,
} from "@/lib/surfaceStack";

/**
 * The stack (lib/surfaceStack.ts) wired to a host, plus the two things a
 * browser needs to agree with it.
 *
 * SYSTEM BACK. A phone reader's back gesture and the in-app Back arrow must do
 * the same thing; two different backs is worse than one. So every open pushes a
 * history entry stamped with its depth, and a popstate that lands on a shallower
 * stamp pops the stack to match. The stamp lives under its own key, so the
 * Map's selection sentinel (lib/mapSelectionHistory.ts) keeps owning `sel`
 * without either one guessing at the other's entries.
 *
 * RESTORE. `onRestore` is handed the parent entry on Back, so the host puts the
 * reader back where they were rather than reopening a default.
 */

export const SURFACE_HISTORY_KEY = "pubmaxSurfaceDepth";

export function surfaceHistoryDepth(state: unknown): number {
  if (!state || typeof state !== "object") return 0;
  const depth = (state as Record<string, unknown>)[SURFACE_HISTORY_KEY];
  return typeof depth === "number" && Number.isFinite(depth) && depth > 0 ? depth : 0;
}

export function stampSurfaceHistory(state: unknown, depth: number): unknown {
  const base = state && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {};
  if (depth <= 0) {
    delete base[SURFACE_HISTORY_KEY];
    return base;
  }
  base[SURFACE_HISTORY_KEY] = depth;
  return base;
}

export type SurfaceStackApi<S> = {
  stack: SurfaceStack<S>;
  depth: number;
  current: SurfaceEntry<S> | null;
  parent: SurfaceEntry<S> | null;
  canGoBack: boolean;
  /** The Back action's accessible name, or null when the parent is home. */
  backLabel: string | null;
  /** Open a surface over the current one. */
  open: (entry: SurfaceEntry<S>) => void;
  /** Update the current surface's remembered state without moving. */
  remember: (state: S) => void;
  /** Step back one level, restoring the parent's state. */
  back: () => void;
  /** Leave every open surface, from any depth. */
  home: () => void;
};

export function useSurfaceStack<S>({
  onRestore,
  onHome,
  syncHistory = true,
}: {
  /**
   * Put the reader back on `entry` with the state it holds. Called on Back with
   * the parent entry, and with null when Back reaches the top level.
   */
  onRestore: (entry: SurfaceEntry<S> | null) => void;
  /** Leave every surface. Defaults to `onRestore(null)`. */
  onHome?: () => void;
  /** Whether the browser's Back agrees with this stack. Off in tests. */
  syncHistory?: boolean;
}): SurfaceStackApi<S> {
  const [stack, setStack] = useState<SurfaceStack<S>>(ROOT_SURFACE_STACK as SurfaceStack<S>);
  const stackRef = useRef(stack);
  const onRestoreRef = useRef(onRestore);
  const onHomeRef = useRef(onHome);
  // A history move this hook made itself. The popstate listener must not treat
  // it as the reader's back gesture and pop a second time.
  const selfMoveRef = useRef(0);
  useEffect(() => {
    stackRef.current = stack;
    onRestoreRef.current = onRestore;
    onHomeRef.current = onHome;
  }, [onHome, onRestore, stack]);

  const open = useCallback((entry: SurfaceEntry<S>) => {
    setStack((held) => {
      const next = openSurface(held, entry);
      if (syncHistory && typeof window !== "undefined" && next.length > held.length) {
        window.history.pushState(
          stampSurfaceHistory(window.history.state, next.length),
          "",
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
        );
      }
      return next;
    });
  }, [syncHistory]);

  const remember = useCallback((state: S) => {
    setStack((held) => rememberSurfaceState(held, state));
  }, []);

  const back = useCallback(() => {
    const held = stackRef.current;
    if (!held.length) return;
    const next = backSurface(held);
    setStack(next);
    onRestoreRef.current(currentSurface(next));
    if (syncHistory && typeof window !== "undefined" && surfaceHistoryDepth(window.history.state) === held.length) {
      selfMoveRef.current += 1;
      window.history.back();
    }
  }, [syncHistory]);

  const home = useCallback(() => {
    const held = stackRef.current;
    setStack(homeSurface<S>());
    if (onHomeRef.current) onHomeRef.current();
    else onRestoreRef.current(null);
    if (syncHistory && typeof window !== "undefined") {
      const drop = Math.min(surfaceHistoryDepth(window.history.state), held.length);
      if (drop > 0) {
        selfMoveRef.current += 1;
        window.history.go(-drop);
      }
    }
  }, [syncHistory]);

  // The reader's own back gesture. Landing on a shallower stamp than the stack
  // we hold means they stepped out of a surface, so the stack follows them.
  useEffect(() => {
    if (!syncHistory || typeof window === "undefined") return;
    const onPop = () => {
      if (selfMoveRef.current > 0) {
        selfMoveRef.current -= 1;
        return;
      }
      const landed = surfaceHistoryDepth(window.history.state);
      const held = stackRef.current;
      if (landed >= held.length) return;
      const next = held.slice(0, landed);
      stackRef.current = next;
      setStack(next);
      onRestoreRef.current(currentSurface(next));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [syncHistory]);

  return useMemo(
    () => ({
      stack,
      depth: surfaceDepth(stack),
      current: currentSurface(stack),
      parent: parentSurface(stack),
      canGoBack: canGoBack(stack),
      backLabel: backActionLabel(stack),
      open,
      remember,
      back,
      home,
    }),
    [back, home, open, remember, stack],
  );
}
