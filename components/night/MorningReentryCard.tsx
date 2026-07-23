"use client";

// Morning re-entry card (U22). The morning after a completed plan, the first
// time the app opens we greet the user once with "last night, sorted" and a way
// into the recap that wrote itself overnight. Everything else about it is quiet:
// no rating (see note below), no push, no re-appearing.
//
// It renders NOTHING unless lib/morningReentry has a pending completed night
// that is inside its ~36h TTL, was not completed in this very session, and has
// not been shown before. The eligible night is captured ONCE on mount (a later
// same-session completion is intentionally held for the NEXT open), then the
// card marks itself shown so it is strictly one-time across app opens.
//
// Mounted lazily via components/DeferredShellExtras (next/dynamic, ssr:false) so
// it costs nothing on first paint and degrades to nothing when no completed plan
// exists.
//
// Rating: the brief asks for a "Rate the night" affordance ONLY IF an
// allow-listed analytics event already exists for it. lib/analyticsEvents.ts has
// no `night_rating` event, and that registry is owned by another team, so this
// card ships WITHOUT rating. The proposed event is noted in the PR body.

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, Sunrise, X } from "lucide-react";

import {
  markMorningCardShown,
  readShowableMorningNight,
  type CompletedNight,
} from "@/lib/morningReentry";
import "./morningReentry.css";

export default function MorningReentryCard() {
  // Captured once, at mount, from a PRIOR session's completion (this card is
  // loaded with next/dynamic ssr:false, so the lazy initializer runs client-side
  // only). A completion that happens later THIS session is deliberately not read
  // here; it becomes eligible on the next open.
  const [night] = useState<CompletedNight | null>(() => readShowableMorningNight(Date.now()));
  const [dismissed, setDismissed] = useState(false);

  // As soon as the card is eligible, mark it shown so it is one-time across every
  // future open. Local state keeps it on screen for this view regardless.
  useEffect(() => {
    if (night) markMorningCardShown(night.planId);
  }, [night]);

  if (!night || dismissed) return null;

  return (
    <section className="morningCard" role="dialog" aria-modal="false" aria-label="Last night, sorted">
      <button
        type="button"
        className="morningCard__close"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        <X size={18} aria-hidden="true" />
      </button>

      <div className="morningCard__head">
        <span className="morningCard__badge" aria-hidden="true">
          <Sunrise size={16} />
        </span>
        <div>
          <p className="morningCard__eyebrow">Last night, sorted</p>
          <p className="morningCard__lede">Your recap wrote itself overnight.</p>
        </div>
      </div>

      {night.title ? <p className="morningCard__title">{night.title}</p> : null}

      <Link className="morningCard__link" href={`/plan/${night.planId}/recap`} onClick={() => setDismissed(true)}>
        <BookOpen size={16} aria-hidden="true" />
        See your recap
      </Link>
    </section>
  );
}
