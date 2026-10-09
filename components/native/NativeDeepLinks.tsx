"use client";

import { useEffect } from "react";

import { activateNativeBackGesture } from "@/lib/nativeBackGesture";
import { activateNativeDeepLinks } from "@/lib/nativeDeepLinks";
import { nativePlatform } from "@/lib/nativePlatform";
import {
  activateNativePushNavigation,
  refreshNativePushRegistration,
} from "@/lib/nativePush";
import { hasEnabledNativePush } from "@/lib/nativePushPrompt";

/**
 * Renderless native app-link, notification-tap, Android Back and push-refresh
 * lifecycle. Every activator has the same shape (async, resolves a cleanup,
 * no-op off-native) so adding one is adding it to this list.
 */
export default function NativeDeepLinks(): null {
  useEffect(() => {
    let disposed = false;
    const deactivators: Array<() => void> = [];

    const activators: Array<() => Promise<() => void>> = [
      activateNativeDeepLinks,
      activateNativePushNavigation,
    ];
    if (nativePlatform() !== "ios") activators.push(activateNativeBackGesture);
    for (const activate of activators) {
      void activate().then((cleanup) => {
        if (disposed) cleanup();
        else deactivators.push(cleanup);
      });
    }
    if (hasEnabledNativePush()) void refreshNativePushRegistration();

    return () => {
      disposed = true;
      for (const deactivate of deactivators) deactivate();
    };
  }, []);

  return null;
}
