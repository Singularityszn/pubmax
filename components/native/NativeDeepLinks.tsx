"use client";

import { useEffect } from "react";

import { activateNativeDeepLinks } from "@/lib/nativeDeepLinks";
import { activateNativePushNavigation } from "@/lib/nativePush";

/** Renderless listeners for native app links and notification taps. */
export default function NativeDeepLinks(): null {
  useEffect(() => {
    let disposed = false;
    const deactivators: Array<() => void> = [];

    for (const activate of [activateNativeDeepLinks, activateNativePushNavigation]) {
      void activate().then((cleanup) => {
        if (disposed) cleanup();
        else deactivators.push(cleanup);
      });
    }

    return () => {
      disposed = true;
      for (const deactivate of deactivators) deactivate();
    };
  }, []);

  return null;
}
