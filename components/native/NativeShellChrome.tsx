"use client";

// Renderless native-shell document marker.
//
// One attribute on <html>, set only inside the Capacitor wrap, is what scopes
// components/native/nativeShell.css. It is written from an effect rather than
// server-rendered on purpose: the shell loads the SAME production HTML the web
// serves (capacitor.config.ts is remote-URL mode), and "/", "/map", "/tonight",
// "/today" and "/near" are the documents the CDN hands to every stranger
// unchanged (proxy.ts, CDN_CACHED_DOCUMENT_PATHS). A server-rendered native
// flag would either be wrong for the reader who got the cached copy or take
// those routes off the CDN entirely.
//
// The attribute is also the seam a test reads, which is why it is an attribute
// and not a class: a class on <html> is shared with the theme switch and the
// no-js fallback, and a native flag that can be clobbered by either is not a
// fence.

import { useEffect } from "react";

import { isNativeApp, nativePlatform } from "@/lib/nativePlatform";
import { releaseNativeSplashOnFirstPaint } from "@/lib/nativeSplash";
import { followNativeTextScale } from "@/lib/nativeTextScale";
import { installNativeWebShareBridge } from "@/lib/nativeWebShareBridge";
import "./nativeShell.module.css";

/** The attribute components/native/nativeShell.css scopes every rule to. */
export const NATIVE_SHELL_ATTRIBUTE = "data-native-shell";

export default function NativeShellChrome(): null {
  useEffect(() => {
    if (!isNativeApp()) return;
    const root = document.documentElement;
    // The value names the platform so a rule that genuinely differs between
    // iOS and Android has somewhere to hang without a second attribute. The
    // stylesheet only matches on presence today.
    root.setAttribute(NATIVE_SHELL_ATTRIBUTE, nativePlatform() ?? "native");
    // The launch mark stands until the page has painted (lib/nativeSplash.ts).
    const cancelSplashRelease = releaseNativeSplashOnFirstPaint();
    // The Android WebView has no Web Share API; the shell supplies one over
    // the OS picker so every `navigator.share` caller reaches it unchanged.
    const releaseShare = installNativeWebShareBridge();
    // The OS text size: applied on iOS, read on Android, published on <html>
    // either way so the tab bar can change shape rather than overflow.
    const releaseTextScale = followNativeTextScale();
    return () => {
      releaseTextScale();
      releaseShare();
      cancelSplashRelease();
      root.removeAttribute(NATIVE_SHELL_ATTRIBUTE);
    };
  }, []);

  return null;
}
