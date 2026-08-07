"use client";

import { useEffect, useRef, useState } from "react";

import { analyticsCollectionAllowed, trackEvent } from "@/lib/analytics";
import {
  clearPosterLandingSession,
  isPosterLandingSrc,
  posterLandingOrientation,
  readPosterLandingSession,
  rememberPosterLandingSession,
} from "@/lib/posterLanding";

/**
 * One orientation line + closed poster_landing beacon when /near was reached
 * from a printed QR (`src=poster`). Session remembers the arrival so a later
 * patch URL rewrite cannot hide the line in the same tab; organic /near loads
 * without src clear any stale session.
 */
export default function PosterLandingNote({ src }: { src: string | null }) {
  const fromQuery = isPosterLandingSrc(src);
  const [fromSession, setFromSession] = useState(false);
  const recorded = useRef(false);
  const sawPosterSrc = useRef(false);

  useEffect(() => {
    if (fromQuery) {
      sawPosterSrc.current = true;
      rememberPosterLandingSession();
      setFromSession(true);
      return;
    }
    if (!sawPosterSrc.current) {
      clearPosterLandingSession();
    }
    setFromSession(readPosterLandingSession());
  }, [fromQuery]);

  useEffect(() => {
    if (!fromQuery || recorded.current) return;
    recorded.current = true;
    if (!analyticsCollectionAllowed()) return;
    trackEvent("poster_landing");
  }, [fromQuery]);

  if (!fromQuery && !fromSession) return null;

  return <p className="nmnPosterNote">{posterLandingOrientation()}</p>;
}
