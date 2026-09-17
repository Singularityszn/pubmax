"use client";

// Route-segment error boundary. Any unhandled render/runtime error in a page
// (outside the map, which has its own WebGL fallback) lands here as a calm,
// on-brand recovery screen instead of a white screen. `reset()` re-renders the
// segment; the Home link is the always-works escape hatch.
import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it for logs/monitoring; never swallow silently.
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <main id="main"
      role="alert"
      style={{
        minHeight: "100svh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "var(--paper)",
        color: "var(--ink)",
      }}
    >
      <div style={{ maxWidth: "34rem", textAlign: "center" }}>
        {/* An eyebrow with no border and no fill is plain text, not a stamp, so
            it is sentence case with tight tracking (docs/DESIGN_SYSTEM.md, caps
            policy: uppercase is reserved for a bordered or filled mark, and the
            wide tracking only ever existed to make all-caps legible). And a
            coral WORD takes the accent's ink: --brass reads 2.49:1 to 2.91:1 as
            text on the light ladder, which is what --color-accent-ink exists
            for; dark points that token back at the one coral. */}
        <p
          style={{
            margin: "0 0 12px",
            color: "var(--color-accent-ink)",
            fontSize: "0.8rem",
            fontWeight: 700,
            letterSpacing: "0.01em",
          }}
        >
          Last orders interrupted
        </p>
        <h1
          style={{
            margin: "0 0 14px",
            fontFamily: "var(--serif, Georgia, serif)",
            fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
            lineHeight: 1.1,
          }}
        >
          Spilled.
        </h1>
        <p style={{ margin: "0 0 28px", color: "var(--ink-soft)", lineHeight: 1.6 }}>
          Something on our end fell over, not anything you did. Have another go,
          or head back to the front page.
        </p>
        <div
          style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}
        >
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "44px",
              padding: "0 20px",
              // A text button takes --control-radius, never --radius-sm.
              borderRadius: "var(--control-radius, 14px)",
              border: "none",
              background: "var(--ink-deep)",
              color: "var(--color-on-inverse)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <Link
            href="/"
            style={{
              minHeight: "44px",
              display: "inline-flex",
              alignItems: "center",
              padding: "0 20px",
              borderRadius: "var(--control-radius, 14px)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Back to the front page
          </Link>
        </div>
        {error.digest ? (
          <p style={{ marginTop: "20px", color: "var(--muted)", fontSize: "0.76rem" }}>
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
