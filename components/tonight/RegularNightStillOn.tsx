"use client";

// "Still on": the quiet button under a regular night a drinker added (E4).
//
// A different signed-in account may say the night is still on, once, which
// keeps the report 90 more days (PATCH /api/regular-nights). The reporter gets
// no button: the read marks their own rows `own` when it was made with their
// session, and their current handle on an open row says the same thing while
// that read is anonymous. A signed-out or still unresolved viewer gets no
// button either: for them the row is a read, not a door.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { readProviderAccountRevision, readProviderAccountSignal, subscribeProviderIdentityRevision } from "@/lib/authProviderRevision";
import { discardBody } from "@/lib/responseBody";

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
function stillOnOffered(
  night: Pick<DrinkerRegularNight, "own" | "handle">,
  viewer: { signedIn: boolean; identityResolved: boolean; handle: string | null },
): boolean {
  if (!viewer.signedIn || !viewer.identityResolved) return false;
  if (night.own) return false;
  if (night.handle && viewer.handle && night.handle.toLowerCase() === viewer.handle.toLowerCase()) return false;
  return true;
}

type Night = Pick<DrinkerRegularNight, "id" | "own" | "handle">;

export default function RegularNightStillOn({ night }: { night: Night }): React.JSX.Element {
  const accountRevision = useSyncExternalStore(subscribeProviderIdentityRevision, readProviderAccountRevision, () => 0);
  return <RegularNightAction key={`${accountRevision}:${night.id}`} night={night} accountRevision={accountRevision} />;
}

function RegularNightAction({ night, accountRevision }: { night: Night; accountRevision: number }): React.JSX.Element | null {
  const { signedIn } = useViewerSession();
  const { handle, identityResolved } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  if (!stillOnOffered(night, { signedIn, identityResolved, handle })) return null;
  if (phase.kind === "said") {
    return <span className="regularNightStillOnLine" role="status" data-tone={phase.tone}>{phase.line}</span>;
  }

  async function say() {
    if (request.current || readProviderAccountRevision() !== accountRevision) return;
    const controller = new AbortController();
    const accountSignal = readProviderAccountSignal();
    request.current = controller;
    const live = () => !controller.signal.aborted && !accountSignal.aborted && readProviderAccountRevision() === accountRevision;
    setPhase({ kind: "sending" });
    try {
      const response = await authedActionFetch(
        "/api/regular-nights",
        {
          method: "PATCH",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: night.id }),
        },
        { requiresIdentity: true },
      );
      if (!live()) {
        discardBody(response);
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!live()) return;
      setPhase(response.ok
        ? { kind: "said", line: REGULAR_NIGHT_STILL_ON_RECEIPT, tone: "thanks" }
        : { kind: "said", line: offlineOrMessage(errorMessageFrom(body, FAILED)), tone: "refused" });
    } catch {
      if (live()) setPhase({ kind: "said", line: offlineOrMessage(FAILED), tone: "refused" });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  return <button type="button" className="regularNightStillOn" data-still-on={night.id}
    disabled={phase.kind === "sending"} onClick={() => void say()}>{REGULAR_NIGHT_STILL_ON_LABEL}</button>;
}
