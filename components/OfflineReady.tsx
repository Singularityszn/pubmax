"use client";

import { useEffect } from "react";

// Registers the offline service worker (public/sw.js — issue #32, PRD § The
// Spill). Renders nothing and nags about nothing: registration is silent,
// updates install in the background.
//
// The ?v= query carries the per-deploy build id (inlined from next.config.mjs
// as NEXT_PUBLIC_SW_VERSION). A new deploy changes the registration URL, the
// browser treats it as a new worker, and its `activate` step migrates usable
// offline entries before retiring superseded cache versions.
export default function OfflineReady() {
  useEffect(() => {
    // Dev builds churn assets constantly; a SW there only causes confusion.
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      const version = process.env.NEXT_PUBLIC_SW_VERSION || "dev";
      navigator.serviceWorker
        .register(
          `/sw.js?v=${encodeURIComponent(version)}&cache-policy=write-safe-v1`,
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

    // Register after load so the SW never competes with first-paint requests.
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
