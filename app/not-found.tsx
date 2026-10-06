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
      // A dead link is not a place to compose from, and this page has no
      // pathname of its own to be named by (components/nav/createFab.css).
      className="pageHidesCreateFab"
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
        {/* Plain text with no border and no fill, so tight tracking and no
            uppercase transform (docs/DESIGN_SYSTEM.md, caps policy). Coral as
            a word takes the ink token, which clears AA on the light ladder. */}
        <p
          style={{
            margin: "0 0 12px",
            color: "var(--color-accent-ink)",
            fontSize: "0.8rem",
            fontWeight: 700,
            letterSpacing: "0.01em",
          }}
        >
          404
        </p>
        <h1
          style={{
            margin: "0 0 14px",
            fontFamily: "var(--serif, Georgia, serif)",
            fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
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
