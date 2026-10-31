"use client";

// "Is the kitchen still open?" on the food row (launch review idea A1).
//
// The read is one drinker's dated word, "Kitchen open, said @handle 20 min
// ago", and it goes quiet after 90 minutes. It is never hours and never a
// venue fact. A signed-in drinker taps "Still serving" or "Kitchen closed";
// a second account's matching tap confirms it once. A signed-out or still
// unresolved viewer sees the read and no buttons: the row is a read, not a
// door.

import { useEffect, useState } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
import {
  KITCHEN_CONFIRMED_LINE,
  KITCHEN_REPORTED_LINE,
  KITCHEN_STATES,
  KITCHEN_TAP_LABELS,
  KITCHEN_TAP_PROMPT,
  kitchenReadingLine,
  parseKitchenReading,
  type KitchenState,
  type PublicKitchenReport,
} from "@/lib/kitchenReports";
import { discardBody } from "@/lib/responseBody";

const FAILED = "Couldn't send that. Try again.";
/** The read ages on screen, so a held answer goes quiet at 90 minutes. */
const AGE_TICK_MS = 60_000;

type Held = { venueId: string; report: PublicKitchenReport | null };
type Note = { venueId: string; line: string; tone: "thanks" | "refused" };

function useKitchenReading(venueId: string): [PublicKitchenReport | null, (next: Held) => void] {
  const [held, setHeld] = useState<Held | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/kitchen-reports?venueId=${encodeURIComponent(venueId)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          discardBody(response);
          return;
        }
        const body: unknown = await response.json();
        if (!controller.signal.aborted) setHeld({ venueId, report: parseKitchenReading(body, Date.now()) });
      } catch {
        // A read that could not answer prints nothing, never "no reports".
      }
    })();
    return () => controller.abort();
  }, [venueId]);
  return [held?.venueId === venueId ? held.report : null, setHeld];
}

function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** A landed tap: the reading it left, and the thanks for it. */
function readTapAnswer(body: unknown): { report: PublicKitchenReport | null; line: string } {
  const outcome = (body as { outcome?: unknown } | null)?.outcome;
  return {
    report: parseKitchenReading(body, Date.now()),
    line: outcome === "confirmed" ? KITCHEN_CONFIRMED_LINE : KITCHEN_REPORTED_LINE,
  };
}

export default function VenueKitchenReport({ venueId }: { venueId: string }) {
  const { signedIn } = useViewerSession();
  const [report, setHeld] = useKitchenReading(venueId);
  const now = useMinuteClock();
  const [sending, setSending] = useState<KitchenState | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const line = report ? kitchenReadingLine(report, Math.max(now, Date.parse(report.reportedAt))) : null;
  const shownNote = note?.venueId === venueId ? note : null;

  async function tap(state: KitchenState) {
    if (sending) return;
    setSending(state);
    setNote(null);
    try {
      const response = await authedActionFetch(
        "/api/kitchen-reports",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ venueId, state }),
        },
        { requiresIdentity: true },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setNote({ venueId, line: offlineOrMessage(errorMessageFrom(body, FAILED)), tone: "refused" });
        return;
      }
      const answer = readTapAnswer(body);
      setHeld({ venueId, report: answer.report });
      setNote({ venueId, line: answer.line, tone: "thanks" });
    } catch {
      setNote({ venueId, line: offlineOrMessage(FAILED), tone: "refused" });
    } finally {
      setSending(null);
    }
  }

  if (!line && !signedIn) return null;
  return (
    <div className="kitchenReport" data-kitchen-report={report?.state ?? "none"}>
      {line ? (
        <p className="kitchenReportLine" data-confirmed={report?.confirmed ? "true" : "false"}>
          {line}
        </p>
      ) : null}
      {signedIn ? (
        <div className="kitchenReportTaps" role="group" aria-label={KITCHEN_TAP_PROMPT}>
          <span className="kitchenReportPrompt">{KITCHEN_TAP_PROMPT}</span>
          {KITCHEN_STATES.map((state) => (
            <button
              key={state}
              type="button"
              className="kitchenReportTap"
              data-kitchen-tap={state}
              disabled={sending !== null}
              onClick={() => void tap(state)}
            >
              {KITCHEN_TAP_LABELS[state]}
            </button>
          ))}
        </div>
      ) : null}
      {shownNote ? (
        <p className="kitchenReportNote" role="status" data-tone={shownNote.tone}>
          {shownNote.line}
        </p>
      ) : null}
    </div>
  );
}
