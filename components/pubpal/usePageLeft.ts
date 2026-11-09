"use client";

import { useEffect, useRef } from "react";

import { isNativeApp } from "@/lib/nativePlatform";

/**
 * Calls `onLeft` when the person can no longer see the page: the tab is
 * hidden, the screen locks, the page is put away, or the native app enters
 * the background. A live microphone must not keep running unseen.
 */
export function usePageLeft(onLeft: () => void): void {
  const onLeftRef = useRef(onLeft);
  useEffect(() => {
    onLeftRef.current = onLeft;
  }, [onLeft]);

  useEffect(() => {
    const left = () => onLeftRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") left();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", left);

    let disposed = false;
    let removeNative: (() => void) | undefined;
    if (isNativeApp()) {
      void import("@capacitor/app").then(({ App }) =>
        App.addListener("pause", left),
      ).then((handle) => {
        if (disposed) void handle.remove();
        else removeNative = () => void handle.remove();
      }).catch(() => undefined);
    }

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", left);
      removeNative?.();
    };
  }, []);
}
