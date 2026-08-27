import type { PlanMemberRole } from "@/lib/plan";

type VolatileCapability = { token: string; collaborationAuthorized: boolean; role: PlanMemberRole | null };

const volatile = new Map<string, VolatileCapability>();
const restoration = new Map<string, Promise<VolatileCapability | null>>();
const legacyRecovery = new Map<string, string>();
export const PLAN_HTTP_ONLY_SESSION = "__pubmax_http_only_plan_session__";
/** Keep invite and route surfaces from waiting forever on a stalled session read. */
export const PLAN_SESSION_RESTORE_TIMEOUT_MS = 5_000;

export class PlanSessionUnavailableError extends Error {
  constructor() {
    super("Plan session temporarily unavailable.");
    this.name = "PlanSessionUnavailableError";
  }
}

async function fetchPlanSession(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new PlanSessionUnavailableError());
    }, PLAN_SESSION_RESTORE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

export function planCapabilityEvent(planId: string): string {
  return `pubmax-plan-member-change:${planId}`;
}

export function readPlanCapabilitySnapshot(planId: string): string {
  const fallback = volatile.get(planId);
  return fallback ? `${fallback.token}|${fallback.collaborationAuthorized ? "1" : "0"}|${fallback.role ?? ""}` : "|0|";
}

export function parsePlanCapabilitySnapshot(snapshot: string): VolatileCapability {
  const [token = "", authorized = "0", rawRole = ""] = snapshot.split("|");
  return {
    token,
    collaborationAuthorized: authorized === "1",
    role: rawRole === "host" || rawRole === "guest" ? rawRole : null,
  };
}

export function writePlanCapability(planId: string, capability: VolatileCapability): void {
  volatile.set(planId, capability);
  // Bearer capabilities are intentionally memory-only. Persisted plan
  // continuity stores role labels, never mutation authority or secrets.
  window.dispatchEvent(new Event(planCapabilityEvent(planId)));
}

/** Recover script-inaccessible plan authority without exposing the bearer. */
export function restorePlanCapability(planId: string): Promise<VolatileCapability | null> {
  const current = volatile.get(planId);
  if (current) return Promise.resolve(current);
  const pending = restoration.get(planId);
  if (pending) return pending;
  let legacyToken = legacyRecovery.get(planId) ?? "";
  try {
    legacyToken ||= sessionStorage.getItem(`pubmax-plan-member:${planId}`)
      ?? sessionStorage.getItem(`pubmaxx:plan-creator-token:v1:${planId}`)
      ?? "";
    if (legacyToken) legacyRecovery.set(planId, legacyToken);
    sessionStorage.removeItem(`pubmax-plan-member:${planId}`);
    sessionStorage.removeItem(`pubmax-plan-collaboration:${planId}`);
    sessionStorage.removeItem(`pubmaxx:plan-creator-token:v1:${planId}`);
  } catch {
    // Storage may be blocked; the HttpOnly session remains the primary path.
  }
  const readResponse = async (response: Response): Promise<VolatileCapability | null> => {
      if (response.status >= 500) throw new PlanSessionUnavailableError();
      const body = await response.json().catch(() => null) as { active?: unknown; role?: unknown; collaborationAuthorized?: unknown } | null;
      if (body?.active !== true || (body.role !== "host" && body.role !== "guest")) return null;
      const capability: VolatileCapability = {
        token: PLAN_HTTP_ONLY_SESSION,
        collaborationAuthorized: body.collaborationAuthorized === true,
        role: body.role,
      };
      writePlanCapability(planId, capability);
      return capability;
  };
  const request = (async () => {
    try {
      if (legacyToken) {
        const exchange = await fetchPlanSession(`/api/plans/${planId}/session`, {
          method: "POST",
          cache: "no-store",
          headers: { authorization: `Bearer ${legacyToken}` },
        });
        const exchanged = await readResponse(exchange);
        if (exchanged) {
          legacyRecovery.delete(planId);
          return exchanged;
        }
        if (exchange.status !== 401 && exchange.status !== 403) return null;
        legacyRecovery.delete(planId);
      }
      return await readResponse(await fetchPlanSession(`/api/plans/${planId}/session`, { cache: "no-store" }));
    } catch (error) {
      if (error instanceof PlanSessionUnavailableError) throw error;
      throw new PlanSessionUnavailableError();
    }
  })().finally(() => restoration.delete(planId));
  restoration.set(planId, request);
  return request;
}
