"use client";

import { useEffect } from "react";

import { activateNativeDeepLinks } from "@/lib/nativeDeepLinks";

/** Renderless Capacitor App listener for cold and warm universal/app links. */
export default function NativeDeepLinks(): null {
  useEffect(() => {
    let disposed = false;
    let deactivate: (() => void) | undefined;

    void activateNativeDeepLinks().then((cleanup) => {
      if (disposed) cleanup();
      else deactivate = cleanup;
    });

    return () => {
      disposed = true;
      deactivate?.();
    };
  }, []);

  return null;
}
