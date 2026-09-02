import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { trackEvent } from "@/lib/analytics";
import { authedActionFetch } from "@/lib/authedFetch";
import { isUkBaseVenueId } from "@/lib/wanted";
import type { Venue } from "@/lib/venues";

export type PresenceState = "idle" | "sending" | "here" | "no-handle";

export function usePresence(venue: Venue) {
  const { accountRevision, supabaseAuthState, user } = useAuth();
  const currentUserId = user?.id ?? null;
  // "I'm here tonight" presence (PRD §1.5 / §5.1 — the tonight loop). Opt-in: it
  // only ever fires from a deliberate tap of this button — NO auto-tracking, NO
  // GPS. Identity is the viewer's self-asserted handle (localStorage
  // `pubmax_handle`, the same one the composer uses); with none set we point them
  // to claim one rather than posting anonymously. Local, per-venue state only —
  // setState fires from the click handler (never an effect), plus the
  // React-recommended "reset on prop change during render" below (no effect).
  const [presenceState, setPresenceState] = useState<PresenceState>("idle");
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
    setPresenceState("idle");
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
    if (presenceState === "sending" || presenceState === "here") return;
    if (supabaseAuthState === "unresolved") return;
    if (supabaseAuthState === "authenticated" && !user?.id) return;
    const requestVenueId = venue.id;
    const requestUserId = user?.id ?? null;
    const requestAccountRevision = accountRevision;
    const handle =
      typeof window === "undefined" ? "" : (window.localStorage.getItem("pubmax_handle") ?? "").trim();
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
      });
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

  return { presenceState, markPresenceHere };
}
