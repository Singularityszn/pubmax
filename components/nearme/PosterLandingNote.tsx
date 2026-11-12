"use client";

import { useEffect, useRef, useState } from "react";

import { analyticsCollectionAllowed, trackEvent } from "@/lib/analytics";
import { posterArrival } from "@/lib/posterCodes";
import {
  clearPosterLandingSession,
  isPosterLandingSrc,
  posterLandingOrientation,
  readPosterLandingMedium,
  rememberPosterLandingSession,
  type PosterMedium,
} from "@/lib/posterLanding";

type QueryReader = { get(name: string): string | null };

/**
 * One orientation line + poster_landing beacon when /near was reached from a
 * printed QR (`src=poster`). The beacon names the medium and, for a minted
 * code, which poster or mat it was. Session remembers the arrival so a later
 * patch URL rewrite cannot hide the line in the same tab; organic /near loads
 * without src clear any stale session.
 */
export default function PosterLandingNote({ query }: { query: QueryReader | null }) {
  const fromQuery = isPosterLandingSrc(query?.get("src"));
  const arrival = fromQuery && query ? posterArrival(query) : null;
  const medium = arrival?.medium ?? null;
  const code = arrival?.code ?? null;
  const [sessionMedium, setSessionMedium] = useState<PosterMedium | null>(null);
  const recorded = useRef(false);
  const sawPosterSrc = useRef(false);

  useEffect(() => {
    // sessionStorage is the external system here; settle it first, then let a
    // frame callback carry the state update so the effect body stays free of
    // synchronous setState (react-hooks/set-state-in-effect).
    let next: PosterMedium | null;
    if (medium) {
      sawPosterSrc.current = true;
      rememberPosterLandingSession(medium);
      next = medium;
    } else {
      if (!sawPosterSrc.current) {
        clearPosterLandingSession();
      }
      next = readPosterLandingMedium();
    }
    const frame = window.requestAnimationFrame(() => setSessionMedium(next));
    return () => window.cancelAnimationFrame(frame);
  }, [medium]);

  useEffect(() => {
    if (!medium || recorded.current) return;
    recorded.current = true;
    if (!analyticsCollectionAllowed()) return;
    trackEvent("poster_landing", code ? { medium, code } : { medium });
  }, [medium, code]);

  const shown = medium ?? sessionMedium;
  if (!shown) return null;

  return <p className="nmnPosterNote">{posterLandingOrientation(shown)}</p>;
}
