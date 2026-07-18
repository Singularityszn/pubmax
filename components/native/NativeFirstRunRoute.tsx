"use client";

// Mounted only on the homepage (app/page.tsx) — the route the Capacitor
// remote-URL wrap always opens first (capacitor.config.ts `server.url` has
// no path). On a genuine first native launch with no existing city
// preference it replaces the marketing landing with the map, once, then
// never again (lib/nativeFirstRun.ts owns the gate + persistence). Renders
// nothing; a no-op on the web and on every later launch.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { preferredCityMapHref, readPreferredCity } from "@/lib/cityPreference";
import {
  hasRoutedNativeFirstRun,
  markNativeFirstRunRouted,
  shouldRouteNativeFirstRun,
} from "@/lib/nativeFirstRun";
import { isNativeApp } from "@/lib/nativePlatform";

export default function NativeFirstRunRoute(): null {
  const router = useRouter();

  useEffect(() => {
    const shouldRoute = shouldRouteNativeFirstRun({
      isNative: isNativeApp(),
      alreadyRouted: hasRoutedNativeFirstRun(),
      hasCityPreference: readPreferredCity() !== null,
    });
    if (!shouldRoute) return;
    // Mark first so a slow router transition (or a second effect run in
    // strict mode) can never double-fire or loop.
    markNativeFirstRunRouted();
    router.replace(preferredCityMapHref());
  }, [router]);

  return null;
}
