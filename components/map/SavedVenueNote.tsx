"use client";

import { formatObservedDate } from "@/lib/dataFreshnessFormat";

import "./savedVenueNote.css";

/** Names the day a sheet drawn from this device's saved copy was saved. */
export default function SavedVenueNote({ savedAt }: { savedAt: string | null }) {
  if (!savedAt) return null;
  return (
    <p className="savedVenueNote" role="status">
      Offline. Showing what we saved on{" "}
      <time dateTime={savedAt}>{formatObservedDate(new Date(savedAt))}</time>.
    </p>
  );
}
