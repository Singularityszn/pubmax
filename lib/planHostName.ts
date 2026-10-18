import { cleanCrewName } from "@/lib/crew";

/**
 * The host name a person typed on this device, so the plan composer asks for it
 * once and not every night. It is public (the plan, the share card, the
 * unfurler), so it speaks for a person: the key sits in
 * DEVICE_IDENTITY_LOCAL_KEYS (lib/deviceAccountIdentity.ts) and goes when the
 * account on the device changes or signs out.
 */
export const PLAN_HOST_NAME_KEY = "pubmax:plan-host-name:v1";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

// An email address is never a host name (battle test L05, lib/crew.ts), so one
// typed into the field is used for that plan and not remembered.
function rememberable(name: string): boolean {
  return Boolean(name) && !name.includes("@");
}

/** The remembered host name, cleaned; empty when none is held or storage is blocked. */
export function readRememberedPlanHostName(storage: ReadableStorage | null): string {
  if (!storage) return "";
  try {
    const name = cleanCrewName(storage.getItem(PLAN_HOST_NAME_KEY) ?? "");
    return rememberable(name) ? name : "";
  } catch {
    return "";
  }
}

/** Remember the name a plan was locked under. */
export function rememberPlanHostName(storage: WritableStorage | null, value: string): void {
  const name = cleanCrewName(value);
  if (!storage || !rememberable(name)) return;
  try {
    storage.setItem(PLAN_HOST_NAME_KEY, name);
  } catch {
    // Blocked storage asks again next time, which is the old behaviour.
  }
}
