"use client";

// Root-layout error boundary. app/error.tsx (and every other route-segment
// error.tsx) wraps page.tsx/layout.tsx below the root layout, so none of them
// - and neither does <ClientErrorReporter />, mounted inside the root layout's
// own body - ever runs if the root layout itself throws while mounting. This
// is the one boundary above that gap, so it fires its own minimal report
// rather than assuming ClientErrorReporter got a chance to attach.
//
// Next.js requires this file to render its own <html>/<body> and does not
// include globals.css/theme.css here (see the Next docs on global-error), so
// colors below are the design system's light/dark literals rather than the
// custom properties the rest of the app reads - this page can't pick up the
// app's own dark-mode toggle, so it follows the OS scheme like the docs say.
import Link from "next/link";
import { useEffect } from "react";

import { createClientErrorSender } from "@/components/ClientErrorReporter";

const reportRootError = createClientErrorSender();

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[root layout error boundary]", error);
    reportRootError("error", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="pubmaxGlobalError">
        <style>{`
          .pubmaxGlobalError {
            margin: 0;
            min-height: 100svh;
            display: grid;
            place-items: center;
            padding: 24px;
            background: #f8f2ec;
            color: #17171a;
            font-family: system-ui, -apple-system, sans-serif;
          }
          .pubmaxGlobalError .eyebrow { color: #b43b1d; }
          .pubmaxGlobalError .lede { color: #3f3f46; }
          .pubmaxGlobalError .reference { color: #666670; }
          .pubmaxGlobalError .retry { background: #0b0b0d; color: #fdfaf2; }
          .pubmaxGlobalError .home { border-color: #dedcdf; }
          @media (prefers-color-scheme: dark) {
            .pubmaxGlobalError { background: #0a0a0b; color: #eef3ef; }
            .pubmaxGlobalError .eyebrow { color: #ff5a5f; }
            .pubmaxGlobalError .lede { color: #c9c9ce; }
            .pubmaxGlobalError .reference { color: #9a9aa0; }
            .pubmaxGlobalError .retry { background: #060607; color: #fdfaf2; }
            .pubmaxGlobalError .home { border-color: #2c2c30; }
          }
        `}</style>
        <div style={{ maxWidth: "34rem", textAlign: "center" }}>
          <p className="eyebrow" style={{ margin: "0 0 12px", fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.01em" }}>
            Last orders interrupted
          </p>
          <h1 style={{ margin: "0 0 14px", fontSize: "clamp(1.8rem, 4vw, 2.6rem)", lineHeight: 1.1 }}>
            Spilled.
          </h1>
          <p className="lede" style={{ margin: "0 0 28px", lineHeight: 1.6 }}>
            Something on our end fell over, not anything you did. Have another go,
            or head back to the front page.
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => retry()}
              className="retry"
              style={{ minHeight: "44px", padding: "0 20px", borderRadius: "14px", border: "none", fontWeight: 600, cursor: "pointer" }}
            >
              Try again
            </button>
            <Link
              href="/"
              className="home"
              style={{ minHeight: "44px", display: "inline-flex", alignItems: "center", padding: "0 20px", borderRadius: "14px", border: "1px solid", color: "inherit", textDecoration: "none", fontWeight: 600 }}
            >
              Back to the front page
            </Link>
          </div>
          {error.digest ? (
            <p className="reference" style={{ marginTop: "20px", fontSize: "0.76rem" }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
