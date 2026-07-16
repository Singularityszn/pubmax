type VolatileCapability = { token: string; collaborationAuthorized: boolean };

const volatile = new Map<string, VolatileCapability>();

export function planCapabilityEvent(planId: string): string {
  return `pubmax-plan-member-change:${planId}`;
}

export function readPlanCapabilitySnapshot(planId: string): string {
  const fallback = volatile.get(planId);
  if (typeof window === "undefined") return fallback ? `${fallback.token}|${fallback.collaborationAuthorized ? "1" : "0"}` : "|0";
  try {
    const token = sessionStorage.getItem(`pubmax-plan-member:${planId}`) ?? fallback?.token ?? "";
    const collaborationAuthorized = sessionStorage.getItem(`pubmax-plan-collaboration:${planId}`) === "true" || fallback?.collaborationAuthorized === true;
    return `${token}|${collaborationAuthorized ? "1" : "0"}`;
  } catch {
    return fallback ? `${fallback.token}|${fallback.collaborationAuthorized ? "1" : "0"}` : "|0";
  }
}

export function parsePlanCapabilitySnapshot(snapshot: string): VolatileCapability {
  const separator = snapshot.lastIndexOf("|");
  return { token: separator >= 0 ? snapshot.slice(0, separator) : snapshot, collaborationAuthorized: snapshot.slice(separator + 1) === "1" };
}

export function writePlanCapability(planId: string, capability: VolatileCapability): void {
  volatile.set(planId, capability);
  try {
    sessionStorage.setItem(`pubmax-plan-member:${planId}`, capability.token);
    sessionStorage.setItem(`pubmax-plan-collaboration:${planId}`, capability.collaborationAuthorized ? "true" : "false");
  } catch {
    // The module-level value keeps sibling plan surfaces usable this session.
  }
  window.dispatchEvent(new Event(planCapabilityEvent(planId)));
}
