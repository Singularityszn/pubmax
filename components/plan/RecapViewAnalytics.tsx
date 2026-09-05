"use client";

import { useLoopMoment } from "@/components/loop/useLoopMoment";
import type { RecapVisibility } from "@/lib/analyticsEvents";

/**
 * The ONE emitter of `recap_viewed`, and it serves the PUBLISHED recap alone
 * (`/recap/[storyId]`).
 *
 * The private crew recap at `/plan/[id]/recap` is deliberately not this event:
 * `MemoryReviewAnalytics` already reports that read as `memory_reviewed`, and
 * two names for one read would double every recap figure on the dashboard.
 * What this answers is the missing middle of the share loop - a recap was
 * shared (`recap_shared`), somebody read it, and a night was committed
 * (`next_night_committed`).
 *
 * Only the story's own visibility travels, so "does an unlisted link travel"
 * is answerable without a story id, a title, a handle, or a venue.
 */
export default function RecapViewAnalytics({
  visibility,
}: {
  visibility: RecapVisibility;
}) {
  useLoopMoment("recap_viewed", visibility, { visibility });
  return null;
}
