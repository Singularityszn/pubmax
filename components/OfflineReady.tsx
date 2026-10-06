"use client";

import { useEffect } from "react";

// Registers the offline service worker (public/sw.js — issue #32, PRD § The
// Spill). Renders nothing and nags about nothing: registration is silent,
// updates install in the background.
//
// The ?v= query carries the per-deploy build id (inlined from next.config.mjs
// as NEXT_PUBLIC_SW_VERSION). A new deploy changes the registration URL, the
// browser treats it as a new worker. public/sw.js owns activation and cache
// migration. public/sw-plan-cache.js documents Plan cache retirement.
//
// REGISTRATION IS OWED TO EVERY ROUTE, NOT ONLY THE MAP. The first-pins gate
// below exists so installing the worker cannot tax the map's cold path, and it
// is kept for exactly that. What it may not be is the ONLY key: the native
// shell cold-starts on /tonight (lib/entryDecision.ts), so a reader whose
// sessions are Tonight, Out, Social or You never opened /map, never fired
// `pubmax:first-pins`, and got no offline shell at all — in an app whose
// worker header says pub cellars have terrible signal. So there are TWO
// triggers now and the EARLIER one wins: first pins where they happen, and a
// deferred idle pass on any route otherwise. The deferred pass is held back by
// a delay rather than armed at the first idle moment, because on /map the
// first idle moment IS the cold path this gate was written to protect.

/** Idle deadline once a trigger has fired. Unchanged from the first-pins path. */
const OFFLINE_REGISTER_IDLE_TIMEOUT_MS = 2_000;
/** How long a loaded route waits before registering without a first-pins event. */
export const OFFLINE_REGISTER_FALLBACK_DELAY_MS = 4_000;

export default function OfflineReady() {
  useEffect(() => {
    // Dev builds churn assets constantly; a SW there only causes confusion.
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let registered = false;
    let pageLoaded = document.readyState === "complete";
    let firstPinsReady = Boolean(window.__pubmaxFirstPinsReady);
    let fallbackTimer: number | undefined;
    try {
      firstPinsReady =
        firstPinsReady ||
        window.localStorage.getItem("pubmax:first-pins-seen:v1") === "1";
    } catch {
      // A blocked storage area leaves the in-memory signal as the fallback.
    }

    const register = () => {
      if (registered) return;
      registered = true;
      const version = process.env.NEXT_PUBLIC_SW_VERSION?.trim();
      if (!version) return;
      navigator.serviceWorker
        .register(
          `/sw.js?v=${encodeURIComponent(version)}&cache-policy=plan-preview-safe-v2`,
        )
        .then((registration) => {
          registration.addEventListener("updatefound", () => {
            console.info(
              "PUBMAXXING: a new offline version is installing.",
            );
          });
        })
        .catch(() => {
          // Offline support is progressive enhancement — never surface a
          // registration failure to the user.
        });
    };

    const registerWhenIdle = () => {
      if (registered) return;
      const run = () => register();
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(run, { timeout: OFFLINE_REGISTER_IDLE_TIMEOUT_MS });
      } else {
        window.setTimeout(run, 0);
      }
    };

    // The map's trigger: pins are up, the cold path is done, register now.
    const scheduleRegister = () => {
      if (!pageLoaded || !firstPinsReady || registered) return;
      registerWhenIdle();
    };

    // The every-route trigger: the document loaded and stayed quiet for the
    // fallback delay, so whatever this route was doing has settled.
    const scheduleFallbackRegister = () => {
      if (registered || fallbackTimer !== undefined) return;
      fallbackTimer = window.setTimeout(
        registerWhenIdle,
        OFFLINE_REGISTER_FALLBACK_DELAY_MS,
      );
    };

    const onLoad = () => {
      pageLoaded = true;
      scheduleRegister();
      scheduleFallbackRegister();
    };
    const onFirstPins = () => {
      firstPinsReady = true;
      scheduleRegister();
    };

    window.addEventListener("pubmax:first-pins", onFirstPins, { once: true });
    if (pageLoaded) {
      scheduleRegister();
      scheduleFallbackRegister();
    } else {
      window.addEventListener("load", onLoad, { once: true });
    }
    return () => {
      window.removeEventListener("pubmax:first-pins", onFirstPins);
      window.removeEventListener("load", onLoad);
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    };
  }, []);

  return null;
}
