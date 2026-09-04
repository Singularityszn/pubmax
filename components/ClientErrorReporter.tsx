"use client";

import { useEffect } from "react";

import {
  buildClientErrorReport,
  describeThrownValue,
  type ClientErrorKind,
} from "@/lib/clientErrorReport";
import { isNativeApp } from "@/lib/nativePlatform";
import { discardBody } from "@/lib/responseBody";

// Uncaught errors and unhandled rejections, reported once each to our own
// endpoint. Renders nothing (the OfflineReady idiom) and shows the reader
// nothing: an error they have already seen the effect of does not need a
// second announcement, and one they have not noticed must not be turned into
// one by the act of reporting it.
//
// THREE RULES.
//
// 1. IT NEVER RE-ENTERS. The send is wrapped so a failure inside the reporter
//    cannot itself raise an unhandled rejection, which would report itself, and
//    a per-session cap stops a render loop turning one bug into a flood.
// 2. IT NEVER CHANGES WHAT THE PAGE DOES. The listeners do not preventDefault,
//    so the console still shows the error and React's own boundaries still see
//    it.
// 3. IT SENDS NOTHING PERSONAL. lib/clientErrorReport.ts owns that, redacting
//    before the send, and the route redacts again on arrival.

/** One bug should not become a thousand log lines from one tab. */
export const CLIENT_ERROR_SESSION_CAP = 5;

export default function ClientErrorReporter() {
  useEffect(() => {
    let sent = 0;
    // The same error thrown on every render is one finding, not many.
    const seen = new Set<string>();

    const report = (kind: ClientErrorKind, thrown: unknown) => {
      try {
        if (sent >= CLIENT_ERROR_SESSION_CAP) return;
        const { name, message } = describeThrownValue(thrown);
        const built = buildClientErrorReport({
          kind,
          name,
          message,
          path: window.location.pathname,
          shell: isNativeApp() ? "native" : "web",
        });
        if (!built) return;
        const fingerprint = `${built.kind}|${built.name}|${built.message}|${built.route}`;
        if (seen.has(fingerprint)) return;
        seen.add(fingerprint);
        sent += 1;

        const payload = JSON.stringify({
          kind: built.kind,
          name: built.name,
          message: built.message,
          path: built.route,
          shell: built.shell,
        });

        // sendBeacon survives the page going away mid-crash, which is exactly
        // the case this exists for. Where it is missing or refuses the queue,
        // a keepalive fetch is the same promise by another name.
        const beacon = navigator.sendBeacon?.bind(navigator);
        if (beacon?.("/api/client-error", new Blob([payload], { type: "application/json" }))) {
          return;
        }
        void fetch("/api/client-error", {
          method: "POST",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: payload,
        })
          .then(discardBody)
          .catch(() => {
            // Reporting is best effort. A failed report is not an error worth
            // reporting, and raising here would report itself.
          });
      } catch {
        // Same reason: the reporter may never be the thing that throws.
      }
    };

    const onError = (event: ErrorEvent) => {
      report("error", event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      report("unhandledrejection", event.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
