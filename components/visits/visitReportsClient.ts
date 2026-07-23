"use client";

// Client plumbing for the Visit Report surface (Wayfinder 3.4): the venue read
// (reports + honest summary) and the create write. Identity reuses the app-wide
// self-asserted handle convention (localStorage `pubmax_handle`) via the
// ratings client, so a user who already rated a pub never re-enters their handle.

import type { VisitReportSummary } from "@/lib/visitReportSummary";
import type {
  Atmosphere,
  Busyness,
  PriceSanity,
  VisitReportDTO,
  WouldReturn,
} from "@/lib/visitReports";

export { storedHandle, rememberHandle } from "@/components/ratings/ratingsClient";

export type VisitReportVenueRead = {
  reports: VisitReportDTO[];
  summary: VisitReportSummary;
};

export type VisitReportDraft = {
  venueId: string;
  handle: string;
  busyness?: Busyness | null;
  atmosphere?: Atmosphere | null;
  wouldReturn?: WouldReturn | null;
  priceSanity?: PriceSanity | null;
  note?: string;
};

/** Read a venue's visit reports + summary. Resolves null on any failure so the
 *  panel renders its empty state rather than throwing. */
export async function fetchVisitReports(venueId: string): Promise<VisitReportVenueRead | null> {
  try {
    const res = await fetch(`/api/visit-reports?venueId=${encodeURIComponent(venueId)}`);
    if (!res.ok) return null;
    return (await res.json()) as VisitReportVenueRead;
  } catch {
    return null;
  }
}

/** Submit a visit report. Returns the fresh venue read (re-fetched) on success,
 *  or throws with the server's message so the caller can show inline feedback. */
export async function postVisitReport(draft: VisitReportDraft): Promise<void> {
  const res = await fetch("/api/visit-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Couldn't save your visit report just now.");
  }
}
