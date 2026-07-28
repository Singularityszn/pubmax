"use client";

// Client plumbing for the Visit Report surface: the venue read, create write,
// and public flag. Identity reuses the app-wide
// self-asserted handle convention (localStorage `pubmax_handle`) via the
// ratings client, so a user who already rated a pub never re-enters their handle.

import type {
  Busyness,
  Noise,
  Seating,
  ServiceWait,
  VisitReportDTO,
  VisitReportReadStatus,
} from "@/lib/visitReports";

export { storedHandle, rememberHandle } from "@/components/ratings/ratingsClient";

export type VisitReportVenueRead = {
  status: VisitReportReadStatus;
  reports: VisitReportDTO[];
};

export type VisitReportDraft = {
  venueId: string;
  handle: string;
  visitedAt: string;
  busyness?: Busyness | null;
  noise?: Noise | null;
  seating?: Seating | null;
  serviceWait?: ServiceWait | null;
  note?: string;
};

/** Read a venue's visit reports. A network failure becomes a degraded read so
 * the panel never writes "nothing here" when it could not check. */
export async function fetchVisitReports(venueId: string): Promise<VisitReportVenueRead | null> {
  try {
    const res = await fetch(`/api/visit-reports?venueId=${encodeURIComponent(venueId)}`);
    if (!res.ok) return null;
    return (await res.json()) as VisitReportVenueRead;
  } catch {
    return null;
  }
}

/** Queue one report for moderator review. The server derives reporter identity
 * from the request and ignores any client identity claim. */
export async function reportVisitReport(id: string): Promise<void> {
  const res = await fetch("/api/visit-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "report", id }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Couldn't report this visit note just now.");
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
