"use client";

import { useEffect } from "react";

import { activateNativeBackGesture } from "@/lib/nativeBackGesture";
import { nativePlatform } from "@/lib/nativePlatform";

/** iOS history handling must be ready before optional native chunks arrive. */
export default function NativeBackGesture(): null {
  useEffect(() => {
    if (nativePlatform() !== "ios") return;
    let disposed = false;
    let deactivate: (() => void) | undefined;
    void activateNativeBackGesture().then((cleanup) => {
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
