// ONE live invite token per Plan, and every share href reads it.
//
// THE DEFECT THIS OWNS (core-loop battle test M04): rotating the invite link
// answered "New link ready. The old one stopped working." while the Send on
// WhatsApp href beside it still carried the retired token, because the rotate
// control kept its own state and each share surface had fetched its own copy at
// mount. The old token is refused by the server, so a host who shared straight
// after rotating sent a dead link and only a reload put it right.
//
// So the token lives here, in the `lib/planSessionCapability.ts` idiom: one
// volatile per-plan value, one window event, and every surface reading it
// through `useSyncExternalStore`. A rotate writes the new token once and every
// href follows in the same frame.
//
// The answer is FOUR-WAY, because "we have not asked yet", "there is no token
// for you" and "we could not read" are three different things to a reader, and
// merging them is how a surface promises a link it cannot produce.

import { discardBody } from "@/lib/responseBody";

export type PlanInviteTokenState = "unknown" | "ready" | "missing" | "unavailable";

export type PlanInviteTokenSnapshot = {
  state: PlanInviteTokenState;
  token: string | null;
};

const live = new Map<string, PlanInviteTokenSnapshot>();
const inFlight = new Map<string, Promise<string | null>>();

const UNKNOWN: PlanInviteTokenSnapshot = { state: "unknown", token: null };

export function planInviteTokenEvent(planId: string): string {
  return `pubmax-plan-invite-token:${planId}`;
}

/** Stable string snapshot for `useSyncExternalStore`. */
export function readPlanInviteTokenSnapshot(planId: string): string {
  const held = live.get(planId);
  return held ? `${held.state}|${held.token ?? ""}` : "unknown|";
}

export function parsePlanInviteTokenSnapshot(snapshot: string): PlanInviteTokenSnapshot {
  const separator = snapshot.indexOf("|");
  if (separator < 0) return UNKNOWN;
  const state = snapshot.slice(0, separator);
  const token = snapshot.slice(separator + 1);
  if (state === "ready") return token ? { state: "ready", token } : UNKNOWN;
  if (state === "missing" || state === "unavailable") return { state, token: null };
  return UNKNOWN;
}

function publish(planId: string, snapshot: PlanInviteTokenSnapshot): void {
  live.set(planId, snapshot);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(planInviteTokenEvent(planId)));
}

/**
 * Record the token a rotate just minted. This is the whole of M04's fix: the
 * one write every share href is watching.
 */
export function writePlanInviteToken(planId: string, token: string | null): void {
  publish(planId, token ? { state: "ready", token } : { state: "missing", token: null });
}

/** Forget one Plan's token, so a surface asks again rather than sharing a stale one. */
export function clearPlanInviteToken(planId: string): void {
  live.delete(planId);
  inFlight.delete(planId);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(planInviteTokenEvent(planId)));
}

/**
 * Read this Plan's invite token from the capability-gated projection.
 *
 * Concurrent callers share one request, so several share surfaces on one page
 * cost one read between them.
 */
export function refreshPlanInviteToken(planId: string): Promise<string | null> {
  const pending = inFlight.get(planId);
  if (pending) return pending;
  const request = (async () => {
    try {
      const response = await fetch(`/api/plans/${planId}`, { cache: "no-store" });
      if (!response.ok) {
        discardBody(response);
        publish(planId, { state: "unavailable", token: null });
        return null;
      }
      const body = await response.json().catch(() => null) as { inviteToken?: unknown } | null;
      const token = typeof body?.inviteToken === "string" && body.inviteToken
        ? body.inviteToken
        : null;
      writePlanInviteToken(planId, token);
      return token;
    } catch {
      publish(planId, { state: "unavailable", token: null });
      return null;
    }
  })().finally(() => {
    if (inFlight.get(planId) === request) inFlight.delete(planId);
  });
  inFlight.set(planId, request);
  return request;
}

/**
 * The held token when there is one, else one shared read.
 *
 * A read we could not RUN is not an answer about this Plan, so `unavailable` is
 * re-asked exactly as `unknown` is: one network blip may not downgrade the
 * host's share tools to a bare `/plan/{id}` link for the life of a page they
 * never reload. `ready` and `missing` are answers and are held.
 */
export function ensurePlanInviteToken(planId: string): Promise<string | null> {
  const held = live.get(planId);
  if (held && held.state !== "unknown" && held.state !== "unavailable") {
    return Promise.resolve(held.token);
  }
  return refreshPlanInviteToken(planId);
}
