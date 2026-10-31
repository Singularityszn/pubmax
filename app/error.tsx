"use client";

// Route-segment error boundary. Any unhandled render/runtime error in a page
// (outside the map, which has its own WebGL fallback) lands here as a calm,
// on-brand recovery screen instead of a white screen. `retry()` re-fetches and
// re-renders the segment; the Home link is the always-works escape hatch.
import Link from "next/link";
import { useEffect } from "react";

import { SpilledGlassArt } from "@/components/brand/DotGlassArt";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
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
        {/* A spilled pint in dots, the picture of "Spilled.": decoration only,
            so it is hidden from assistive tech (DotGlassArt.tsx). */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "18px" }}>
          <SpilledGlassArt />
        </div>
        {/* An eyebrow with no border and no fill is plain text, not a stamp, so
            it is sentence case with tight tracking (docs/DESIGN_SYSTEM.md, caps
            policy: uppercase is reserved for a bordered or filled mark, and the
            wide tracking only ever existed to make all-caps legible). A kicker
            is a label, so it takes the muted ink, never coral
            (docs/DESIGN_SYSTEM.md "Coral is spent twice"). */}
        <p
          style={{
            margin: "0 0 12px",
            color: "var(--color-text-muted)",
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
            onClick={() => retry()}
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
