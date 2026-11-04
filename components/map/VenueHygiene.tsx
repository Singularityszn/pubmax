"use client";

// Food hygiene badge (FSA FHRS) on the venue sheet Overview.
//
// PROVENANCE IS THE FEATURE: this shows the FSA's own published rating. The
// server answers from the exact OSM fhrs:id join when the packs know the pub
// (lib/fsaHygienePack.ts), else from the live postcode + fuzzy name match. The
// client only reads /api/hygiene — it never touches the FHRS upstream. Fail-soft: no confident
// match, an unparseable postcode, or any error renders nothing (no badge, no
// error text). Generation token drops stale writes on rapid venue switches,
// same idiom as VenueBuzz. No animation — reduced-motion compliant by default.

import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useStaggeredRead } from "@/lib/useStaggeredRead";

import { discardBody } from "@/lib/responseBody";
import { holdFsaHygieneBadge } from "@/lib/fsaHygieneMatched";
import DataCreditsLink from "@/components/legal/DataCreditsLink";

import "./venueHygiene.css";

type HygieneRating = {
  fhrsid: number;
  ratingValue: number;
  ratingDate: string | null;
  businessName: string;
  localAuthority: string | null;
};

/** The exact OSM fhrs:id join (lib/fsaHygienePack.ts), with its source and dates. */
type HygieneFact = {
  fhrsid: number;
  rating: "0" | "1" | "2" | "3" | "4" | "5" | "Exempt" | "AwaitingInspection";
  ratingDate: string | null;
  localAuthority: string | null;
  source: string;
  license: string;
  retrievedAt: string;
};

/** What the badge prints, whichever lane answered. */
export type HygieneBadge = {
  fhrsid: number;
  /** "5", "Exempt", "Awaiting inspection". */
  score: string;
  /** Spoken form: "5 out of 5", "exempt", "awaiting inspection". */
  spoken: string;
  ratingDate: string | null;
  localAuthority: string | null;
  /** The visible source line: who said it and when we read it. */
  provenance: string;
};

type Props = {
  venueId: string;
  venueName: string;
  /** Free-text address; the postcode is extracted server-side. */
  address: string;
};

// Format a date as a quiet "Jun 2025" month stamp. Null for a missing or
// unparseable date (fail-soft).
function formatMonth(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Europe/London" });
}

function formatDay(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
}

/** One badge from either lane. Exported for the tests. */
export function hygieneBadge(body: { rating?: HygieneRating | null; fact?: HygieneFact | null }): HygieneBadge | null {
  const fact = body.fact;
  if (fact) {
    const numeric = /^[0-5]$/.test(fact.rating);
    const score = numeric ? fact.rating : fact.rating === "Exempt" ? "Exempt" : "Awaiting inspection";
    const read = formatDay(fact.retrievedAt);
    return {
      fhrsid: fact.fhrsid,
      score,
      spoken: numeric ? `${fact.rating} out of 5` : score.toLowerCase(),
      ratingDate: fact.ratingDate,
      localAuthority: fact.localAuthority,
      provenance: read ? `FSA open data (${fact.license}), read ${read}` : `FSA open data (${fact.license})`,
    };
  }
  const rating = body.rating;
  if (!rating) return null;
  return {
    fhrsid: rating.fhrsid,
    score: String(rating.ratingValue),
    spoken: `${rating.ratingValue} out of 5`,
    ratingDate: rating.ratingDate,
    localAuthority: rating.localAuthority,
    provenance: "FSA ratings API, read live",
  };
}

async function fetchBadge(
  venueId: string,
  name: string,
  address: string,
  signal: AbortSignal,
): Promise<HygieneBadge | null> {
  const params = new URLSearchParams({ venueId, name, postcode: address });
  const res = await fetch(`/api/hygiene?${params.toString()}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    discardBody(res);
    return null;
  }
  return hygieneBadge((await res.json()) as { rating?: HygieneRating | null; fact?: HygieneFact | null });
}

export default function VenueHygiene({ venueId, venueName, address }: Props) {
  const [rating, setRating] = useState<HygieneBadge | null>(null);
  // Which pub the held rating is ABOUT. Adopted during render, so the wait
  // before the next pub's read never shows the previous pub's rating.
  const [ratingFor, setRatingFor] = useState(venueId);
  if (ratingFor !== venueId) {
    setRatingFor(venueId);
    setRating(null);
  }
  const generationRef = useRef(0);
  // Below the first screen: starts after the sheet has painted.
  const ready = useStaggeredRead(2, venueId);

  useEffect(() => {
    if (!ready || !venueId) return;
    const generation = ++generationRef.current;
    // Reset immediately on venue change so the previous pub's rating never
    // lingers (React 19: defer the setState off the effect body).
    void Promise.resolve().then(() => {
      if (generationRef.current === generation) setRating(null);
    });

    const controller = new AbortController();
    (async () => {
      try {
        const next = await fetchBadge(venueId, venueName, address, controller.signal);
        if (controller.signal.aborted || !next) return;
        void Promise.resolve().then(() => {
          if (generationRef.current !== generation) return;
          setRating(next);
        });
      } catch {
        // Fail-soft: no badge is fine.
      }
    })();

    return () => {
      // The effect that ends here owned this generation. Retiring it now, not
      // when the next pub's read starts after its phase delay, is what stops a
      // write the old pub had already queued from landing under the new one.
      generationRef.current += 1;
      controller.abort();
    };
  }, [ready, venueId, venueName, address]);

  // While this badge is rendered, the CityMCP strip drops its own hygiene
  // line for this pub, so hygiene is said once, by the FSA. The mark goes with
  // the badge (lib/fsaHygieneMatched.ts).
  const badgeShown = rating !== null;
  useEffect(() => (badgeShown ? holdFsaHygieneBadge(venueId) : undefined), [badgeShown, venueId]);

  if (!rating) return null;

  // Every fact carries its source and its dates: the month the local authority
  // rated the pub and, under it, who published the rating and when we read it.
  const rated = formatMonth(rating.ratingDate);
  const by = rating.localAuthority ? `, rated by ${rating.localAuthority}` : "";
  const title = `FSA food hygiene rating ${rating.spoken}${by}${rated ? `, ${rated}` : ""}. ${rating.provenance}.`;

  return (
    <>
      <a
        className="venueHygiene"
        href={`https://ratings.food.gov.uk/business/${rating.fhrsid}`}
        target="_blank"
        rel="noreferrer noopener"
        title={title}
        aria-label={title}
      >
        <ShieldCheck size={14} aria-hidden="true" />
        <span className="venueHygieneBody">
          <span className="venueHygieneHead">
            <span className="venueHygieneLabel">Food hygiene</span>
            <span className="venueHygieneScore">{rating.score}</span>
            {rated ? <span className="venueHygieneSource">rated {rated}</span> : null}
          </span>
          <span className="venueHygieneSource venueHygieneProvenance">{rating.provenance}</span>
        </span>
      </a>
      <DataCreditsLink className="venueHygieneCredits" />
    </>
  );
}
