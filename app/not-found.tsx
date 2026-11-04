// Branded 404. Next's default not-found is an unstyled black page; any dead
// link (a retired route, a mistyped path) landed there. This replaces it with a
// calm, on-brand panel that carries the wordmark and points back to the two
// places worth being: the map and tonight. Server component — no client state,
// so it renders instantly inside the root layout. It follows the person's
// theme like every other page. It used to commit to a dark surface in both
// themes, which left the consent bar and the tab bar in light colours on top
// of it (QA journeys report F15).
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyGlassArt } from "@/components/brand/DotGlassArt";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";

// A 404 in a browser tab used to be indistinguishable from the landing page,
// because with no metadata of its own this page inherited the root layout's
// default title (Astra's live walk, 7 Sep 2026, finding B7).
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main id="main"
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
        <span
          style={{
            display: "inline-flex",
            fontSize: "1.6rem",
            marginBottom: "22px",
            color: "var(--ink)",
          }}
        >
          <PubmaxxWordmark />
        </span>
        {/* An empty pint in dots, the picture of "last orders": decoration
            only, so it is hidden from assistive tech (DotGlassArt.tsx). */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "18px" }}>
          <EmptyGlassArt />
        </div>
        {/* The status code is a figure, so it takes the data face, and it is
            a label rather than an action, so muted ink: coral is spent on the
            one primary below (docs/DESIGN_SYSTEM.md, "Coral is spent twice"). */}
        <p
          style={{
            margin: "0 0 12px",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-data)",
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          404
        </p>
        <h1
          style={{
            margin: "0 0 14px",
            fontFamily: "var(--font-display)",
            fontSize: "clamp(var(--text-xl), 4vw, var(--text-3xl))",
            lineHeight: 1.1,
          }}
        >
          Called for last orders here.
        </h1>
        <p
          style={{
            margin: "0 0 28px",
            color: "var(--ink-soft)",
            lineHeight: 1.6,
          }}
        >
          Whatever was here has drunk up and gone home. The pubs haven&rsquo;t.
        </p>
        <div
          style={{
            display: "flex",
            gap: "12px",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {/* Both doors are guarded. Next prefetches a Link on sight, and these
              two are the heaviest routes on the site: on a production build the
              404 injected 17 stylesheet preloads it never used, one per CSS
              chunk of /map and /tonight, and the browser then warned about
              every one of them. It was the noisiest console on the site by a
              factor of six. */}
          <Link
            href="/map"
            prefetch={false}
            style={{
              minHeight: "44px",
              display: "inline-flex",
              alignItems: "center",
              padding: "0 20px",
              borderRadius: "var(--control-radius, 14px)",
              border: "none",
              background: "var(--color-accent)",
              color: "var(--color-on-accent)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Open the map
          </Link>
          <Link
            href="/tonight"
            prefetch={false}
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
            See tonight
          </Link>
        </div>
      </div>
    </main>
  );
}
