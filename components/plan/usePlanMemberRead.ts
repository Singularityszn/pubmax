"use client";

// THE PLAN READ FOLLOWS THE CAPABILITY (core-loop battle test M01, M02).
//
// Every plan surface server-renders the privacy-safe preview and upgrades
// itself through the capability-gated GET /api/plans/[id]. That upgrade read
// used to run once, at mount, so a capability arriving any later than the first
// read changed nothing on screen:
//
//   M01 a host opening their own plan on a second device read before the seat
//       claim had landed, so the claim that bound their seat a moment later
//       left them looking at the invitee teaser until they reloaded.
//   M02 a guest who tapped "I'm in" got their crew row while the route beside
//       it still said "The full route reveals once you join the crew".
//
// Read at mount and after each capability change. Share a pending request only
// while its capability snapshot still matches. A preview requested before
// restoration cannot answer the member read that restoration starts.
//
// Restoring the session is deliberately NOT this hook's job. It belongs to the
// surfaces that own a session lane and gate it on `identityResolved`, because
// asking before identity has resolved cannot spend the recovery write.
//
// THE REQUEST IS SHARED (F-34). Three surfaces ask this one endpoint about one
// Plan - the route, the crew and the Night Mode card - and each one used to
// hold its own request, so a plan page issued the same heavy GET two or three
// times at mount and again on every capability change. `readPlanMemberProjection`
// is the per-plan `inFlight` promise the invite token got in the same commit
// (`lib/planInviteTokenClient.ts`), and it is the ONE place that fetch is
// written down.

import { useEffect, useReducer, useSyncExternalStore } from "react";

import {
  parsePlanCapabilitySnapshot,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
} from "@/lib/planSessionCapability";
import { discardBody } from "@/lib/responseBody";

const inFlight = new Map<string, { snapshot: string; request: Promise<unknown> }>();

/**
 * One capability-gated `GET /api/plans/[id]` shared by every surface asking
 * together. The answer is the parsed body, or null when the read did not RUN,
 * which each caller reads apart from a body that came back the preview.
 *
 * A body nobody reads is a request that never finishes, so the non-ok exit
 * drains (`lib/responseBody.ts`).
 */
export function readPlanMemberProjection(planId: string): Promise<unknown> {
  const snapshot = readPlanCapabilitySnapshot(planId);
  const pending = inFlight.get(planId);
  if (pending?.snapshot === snapshot) return pending.request;
  const request = (async () => {
    try {
      const response = await fetch(`/api/plans/${planId}`, { cache: "no-store" });
      if (!response.ok) {
        discardBody(response);
        return null;
      }
      return await response.json().catch(() => null);
    } catch {
      return null;
    }
  })().finally(() => {
    if (inFlight.get(planId)?.request === request) inFlight.delete(planId);
  });
  inFlight.set(planId, { snapshot, request });
  return request;
}

/** Forget one Plan's shared read, so the next caller issues a fresh one. */
export function clearPlanMemberProjectionRead(planId: string): void {
  inFlight.delete(planId);
}

/** The live capability token for one Plan, or "" while there is none. */
export function usePlanCapabilityToken(planId: string): string {
  return parsePlanCapabilitySnapshot(usePlanCapabilitySnapshot(planId)).token;
}

function usePlanCapabilitySnapshot(planId: string): string {
  const tokenEvent = planCapabilityEvent(planId);
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(tokenEvent, onChange);
      return () => {
        window.removeEventListener(tokenEvent, onChange);
      };
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
}

/**
 * Run `read` at mount, and again whenever the capability changes under it.
 *
 * `read` is handed an `isActive` probe rather than an AbortSignal because both
 * callers own their own request and only need to know whether their answer is
 * still wanted. It must be stable (useCallback), or every render re-reads.
 * The returned action retries a failed read through the same lifecycle.
 */
export function usePlanMemberRead(
  planId: string,
  read: (isActive: () => boolean) => void,
): () => void {
  const snapshot = usePlanCapabilitySnapshot(planId);
  const [attempt, retry] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    let active = true;
    // Check live authority too: a response can settle before React runs cleanup.
    read(() => active && readPlanCapabilitySnapshot(planId) === snapshot);
    return () => {
      active = false;
    };
  }, [snapshot, planId, read, attempt]);
  return retry;
}
