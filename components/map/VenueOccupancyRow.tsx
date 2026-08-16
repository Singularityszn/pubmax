"use client";

// One-tap crowd report on the venue sheet. Desk mode may reuse the hook;
// this row stays the only live copy on the sheet.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth/AuthProvider";
import { captureAccountAuth } from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import {
  OCCUPANCY_LEVELS,
  OCCUPANCY_LEVEL_LABELS,
  occupancyReadingLine,
  occupancyReceiptLine,
  type OccupancyLevel,
} from "@/lib/occupancy";

import { useVenueOccupancy } from "@/components/map/useVenueOccupancy";

import "./venueOccupancy.css";

export type VenueOccupancyRowProps = {
  venueId: string;
  active?: boolean;
  surface?: "venue-sheet" | "pal";
};

export default function VenueOccupancyRow({
  venueId,
  active = true,
  surface = "venue-sheet",
}: VenueOccupancyRowProps) {
  const { user, session, identityResolved } = useAuth();
  const auth = captureAccountAuth(user?.id ?? null, session);
  const { reading, report, reporting, error } = useVenueOccupancy(venueId, active);
  const [receipt, setReceipt] = useState<{ venueId: string; line: string } | null>(
    null,
  );
  const receiptLine = receipt?.venueId === venueId ? receipt.line : null;

  const line = useMemo(() => {
    if (!reading) return "Checking how busy it is.";
    return occupancyReadingLine(reading);
  }, [reading]);

  useEffect(() => {
    if (!reading || receiptLine) return;
    trackReadOnce(venueId, reading.state);
  }, [venueId, reading, receiptLine]);

  async function onTap(level: OccupancyLevel) {
    if (!auth) return;
    const result = await report(level, auth);
    if (!result.ok) return;
    trackEvent("occupancy_reported", { level, surface });
    trackEvent("occupancy_read", { state: result.reading.state });
    if (result.reading.now && result.reading.ageMinutes != null) {
      setReceipt({
        venueId,
        line: occupancyReceiptLine(result.reading.now, result.reading.ageMinutes),
      });
    }
  }

  const shown = receiptLine ?? line;
  const empty = !receiptLine && !reading?.now;

  return (
    <section className="venueOccupancy" aria-label="How busy it is right now">
      <h3 className="venueOccupancyQuestion">How busy is it right now?</h3>
      <p
        className={
          empty
            ? "venueOccupancyReading venueOccupancyReading--empty"
            : "venueOccupancyReading"
        }
        aria-live="polite"
      >
        {shown}
      </p>
      {auth ? (
        <div className="venueOccupancyTaps" role="group" aria-label="Report how busy it is">
          {OCCUPANCY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className="venueOccupancyTap pressable"
              disabled={reporting}
              aria-pressed={reading?.now === level}
              onClick={() => void onTap(level)}
            >
              {OCCUPANCY_LEVEL_LABELS[level]}
            </button>
          ))}
        </div>
      ) : identityResolved ? (
        <p className="venueOccupancySignIn">
          <Link href="/login?mode=signin">Sign in to report</Link>
        </p>
      ) : null}
      {error ? (
        <p className="venueOccupancyError" role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const readOnce = new Set<string>();

function trackReadOnce(venueId: string, state: string) {
  const key = `${venueId}:${state}`;
  if (readOnce.has(key)) return;
  readOnce.add(key);
  if (
    state === "fresh" ||
    state === "stale" ||
    state === "none" ||
    state === "degraded"
  ) {
    trackEvent("occupancy_read", { state });
  }
}
