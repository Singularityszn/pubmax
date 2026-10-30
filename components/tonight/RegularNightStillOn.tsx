"use client";

// "Still on": the quiet button under a regular night a drinker added (E4).
//
// A different signed-in account may say the night is still on, once, which
// keeps the report 90 more days (PATCH /api/regular-nights). The reporter gets
// no button: the read marks their own rows `own` when it was made with their
// session, and their current handle on an open row says the same thing while
// that read is anonymous. A signed-out or still unresolved viewer gets no
// button either: for them the row is a read, not a door.

import { useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
import {
  REGULAR_NIGHT_STILL_ON_LABEL,
  REGULAR_NIGHT_STILL_ON_RECEIPT,
} from "@/lib/regularNightReports";
import type { DrinkerRegularNight } from "@/lib/regularNights";

const FAILED = "Couldn't send that. Try again.";

type Phase = { kind: "idle" } | { kind: "sending" } | { kind: "said"; line: string; tone: "thanks" | "refused" };

/** Whether this reader may be offered "Still on" for this row. */
export function stillOnOffered(
  night: Pick<DrinkerRegularNight, "own" | "handle">,
  viewer: { signedIn: boolean; identityResolved: boolean; handle: string | null },
): boolean {
  if (!viewer.signedIn || !viewer.identityResolved) return false;
  if (night.own) return false;
  if (night.handle && viewer.handle && night.handle.toLowerCase() === viewer.handle.toLowerCase()) return false;
  return true;
}

export default function RegularNightStillOn({
  night,
}: {
  night: Pick<DrinkerRegularNight, "id" | "own" | "handle">;
}): React.JSX.Element | null {
  const { signedIn } = useViewerSession();
  const { handle, identityResolved } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  if (phase.kind === "said") {
    return (
      <span className="regularNightStillOnLine" role="status" data-tone={phase.tone}>
        {phase.line}
      </span>
    );
  }
  if (!stillOnOffered(night, { signedIn, identityResolved, handle })) return null;

  async function say() {
    setPhase({ kind: "sending" });
    try {
      const response = await authedActionFetch(
        "/api/regular-nights",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: night.id }),
        },
        { requiresIdentity: true },
      );
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        setPhase({ kind: "said", line: REGULAR_NIGHT_STILL_ON_RECEIPT, tone: "thanks" });
        return;
      }
      setPhase({ kind: "said", line: offlineOrMessage(errorMessageFrom(body, FAILED)), tone: "refused" });
    } catch {
      setPhase({ kind: "said", line: offlineOrMessage(FAILED), tone: "refused" });
    }
  }

  return (
    <button
      type="button"
      className="regularNightStillOn"
      data-still-on={night.id}
      disabled={phase.kind === "sending"}
      onClick={() => void say()}
    >
      {REGULAR_NIGHT_STILL_ON_LABEL}
    </button>
  );
}
