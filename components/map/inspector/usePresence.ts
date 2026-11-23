import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useContributionGate, type ContributionActionResult } from "@/components/identity/ContributionGateDialog";
import { trackEvent } from "@/lib/analytics";
import { authedActionFetch } from "@/lib/authedFetch";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { readContributionGateStatus } from "@/lib/contributionGateStatus";
import { PRESENCE_TTL_MS } from "@/lib/nightWindows";
import { safeLocalStorage } from "@/lib/safeStorage";
import { isUkBaseVenueId } from "@/lib/wanted";
import type { Venue } from "@/lib/venues";

export type PresenceState = "idle" | "sending" | "here" | "leaving" | "no-handle";

// The sheet forgets its state on a reload or a pub switch, but the mark stays
// live on the server. This record keeps the way out (Leave) beside it.
const PRESENCE_MARK_KEY = "pubmax:presence-mark:v1";

type PresenceMark = { venueId: string; userId: string | null; handle: string; expiresAt: number };

function storedHandle(): string {
  return (safeLocalStorage()?.getItem("pubmax_handle") ?? "").trim();
}

function rememberMark(mark: PresenceMark | null): void {
  try {
    const storage = safeLocalStorage();
    if (mark) storage?.setItem(PRESENCE_MARK_KEY, JSON.stringify(mark));
    else storage?.removeItem(PRESENCE_MARK_KEY);
  } catch {
    // Storage is a convenience here. The server mark is the truth.
  }
}

function restoredPresence(venueId: string, userId: string | null): PresenceState {
  try {
    const raw = safeLocalStorage()?.getItem(PRESENCE_MARK_KEY);
    const mark = raw ? (JSON.parse(raw) as Partial<PresenceMark>) : null;
    const live =
      mark?.venueId === venueId &&
      mark.userId === userId &&
      mark.handle === storedHandle() &&
      typeof mark.expiresAt === "number" &&
      mark.expiresAt > Date.now();
    return live ? "here" : "idle";
  } catch {
    return "idle";
  }
}

export function usePresence(venue: Venue) {
  const { accountRevision, supabaseAuthState, user } = useAuth();
  const currentUserId = user?.id ?? null;
  // A signed-in tap goes through the shared contribution gate, so a 403 that
  // asks for the 18+ answer opens the one-tap dialog and retries. The
  // signed-out demo lane keeps its direct tap.
  const { requestContribution, contributionGateDialog: presenceGateDialog } = useContributionGate();
  const signedIn = supabaseAuthState === "authenticated" && currentUserId !== null;
  // "I'm here tonight" presence (PRD §1.5 / §5.1 — the tonight loop). Opt-in: it
  // only ever fires from a deliberate tap of this button — NO auto-tracking, NO
  // GPS. The button reads localStorage.pubmax_handle and asks for a handle when
  // none is set. app/api/presence/route.ts owns identity and permission checks.
  // State is local to this venue. setState runs in the click handler and the
  // React "reset on prop change during render" pattern below.
  const [presenceState, setPresenceState] = useState<PresenceState>(() =>
    restoredPresence(venue.id, currentUserId),
  );
  // The panel isn't remounted when the selected pub changes (PubMap keeps one
  // VenueInspector), so a stale "You're here" would linger on the next venue.
  // React's adjust-state-during-render pattern resets it when the venue id
  // changes — no effect, so react-hooks/set-state-in-effect stays satisfied.
  const [presenceScope, setPresenceScope] = useState(() => ({
    venueId: venue.id,
    userId: currentUserId,
    accountRevision,
  }));
  if (
    presenceScope.venueId !== venue.id ||
    presenceScope.userId !== currentUserId ||
    presenceScope.accountRevision !== accountRevision
  ) {
    setPresenceScope({ venueId: venue.id, userId: currentUserId, accountRevision });
    setPresenceState(restoredPresence(venue.id, currentUserId));
  }

  // Live venue id for the stale-response guard below: a check-in resolving
  // after the viewer has switched pubs must never flip the NEW panel to "here".
  // Updated in an effect (never during render — react-hooks/refs) which is
  // early enough: the fetch below can only resolve after effects have run.
  const currentVenueIdRef = useRef(venue.id);
  useEffect(() => {
    currentVenueIdRef.current = venue.id;
  }, [venue.id]);
  const currentUserIdRef = useRef<string | null>(currentUserId);
  const currentAccountRevisionRef = useRef(accountRevision);
  useLayoutEffect(() => {
    currentUserIdRef.current = currentUserId;
    currentAccountRevisionRef.current = accountRevision;
  }, [accountRevision, currentUserId]);

  async function markPresenceHere() {
    if (presenceState === "sending" || presenceState === "here" || presenceState === "leaving") return;
    if (supabaseAuthState === "unresolved" || supabaseAuthState === "unavailable") return;
    if (supabaseAuthState === "authenticated" && !user?.id) return;
    if (signedIn) await requestContribution(mark);
    else await mark();
  }

  async function mark(): Promise<ContributionActionResult> {
    const requestVenueId = venue.id;
    const requestUserId = user?.id ?? null;
    const requestAccountRevision = accountRevision;
    const requestAccountSignal = readProviderAccountSignal();
    const handle = storedHandle();
    if (!handle) {
      setPresenceState("no-handle");
      return;
    }
    setPresenceState("sending");
    try {
      const res = await authedActionFetch("/api/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, venueId: venue.id }),
        signal: requestAccountSignal,
      }, { requiresIdentity: true });
      const refusal = res.ok ? null : await res.json().catch(() => null) as { status?: unknown; error?: string } | null;
      if (res.ok) {
        rememberMark({
          venueId: requestVenueId,
          userId: requestUserId,
          handle,
          expiresAt: Date.now() + PRESENCE_TTL_MS,
        });
      }
      // Stale-response guard: the pub changed while this request was in
      // flight — the adjust-during-render reset already put the new venue on
      // "idle", so drop this response rather than stamping the wrong pub.
      if (
        currentVenueIdRef.current !== requestVenueId ||
        currentUserIdRef.current !== requestUserId ||
        currentAccountRevisionRef.current !== requestAccountRevision
      ) {
        return;
      }
      // Presence is best-effort: a non-ok response still lands the viewer back on
      // an actionable state rather than a spinner. A 200 confirms "you're here".
      setPresenceState(res.ok ? "here" : "idle");
      const gateStatus = readContributionGateStatus(refusal?.status);
      if (gateStatus) return { status: gateStatus, error: refusal?.error };
      if (res.ok) {
        try {
          const body = (await res.json()) as {
            wantedFulfilled?: number;
            wantedNote?: string;
          };
          if (body.wantedFulfilled && body.wantedFulfilled > 0) {
            trackEvent("wanted_fulfilled", {
              venueKind: isUkBaseVenueId(requestVenueId) ? "uk_base" : "curated",
            });
            if (
              body.wantedNote &&
              typeof window !== "undefined" &&
              currentVenueIdRef.current === requestVenueId &&
              currentUserIdRef.current === requestUserId &&
              currentAccountRevisionRef.current === requestAccountRevision
            ) {
              window.dispatchEvent(
                new CustomEvent("pubmax:wanted-fulfilled", {
                  detail: { note: body.wantedNote, userId: requestUserId },
                }),
              );
            }
          }
        } catch {
          // Body parse is optional beside presence success.
        }
      }
    } catch {
      if (
        currentVenueIdRef.current !== requestVenueId ||
        currentUserIdRef.current !== requestUserId ||
        currentAccountRevisionRef.current !== requestAccountRevision
      ) {
        return;
      }
      setPresenceState("idle");
    }
  }

  async function leavePresenceHere() {
    if (presenceState !== "here") return;
    const requestVenueId = venue.id;
    const requestUserId = currentUserId;
    const requestAccountRevision = accountRevision;
    const handle = storedHandle();
    setPresenceState("leaving");
    let left = false;
    try {
      const res = await authedActionFetch("/api/presence", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
        signal: readProviderAccountSignal(),
      }, { requiresIdentity: true });
      left = res.ok;
      if (left) rememberMark(null);
    } catch {
      left = false;
    }
    if (
      currentVenueIdRef.current !== requestVenueId ||
      currentUserIdRef.current !== requestUserId ||
      currentAccountRevisionRef.current !== requestAccountRevision
    ) {
      return;
    }
    setPresenceState(left ? "idle" : "here");
  }

  return { presenceState, markPresenceHere, leavePresenceHere, presenceGateDialog };
}
