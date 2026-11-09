// Which night's crew the map may ask about. A client pointer only: it names
// the Plan and the door (a Plan seat or an Open Crew seat) and holds no
// capability, no position and no name. The private route decides who reads.

import { isPlanId } from "@/lib/planId";

export type LiveLocationNight = { planId: string; via: "plan" | "crew"; endsAt: string };

const KEY = "pubmax_live_location_night";
const EVENT = "pubmax:live-location-night";

function parse(raw: string | null): LiveLocationNight | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LiveLocationNight>;
    if (!isPlanId(value.planId) || (value.via !== "plan" && value.via !== "crew")
      || typeof value.endsAt !== "string" || !(Date.parse(value.endsAt) > Date.now())) return null;
    return { planId: value.planId, via: value.via, endsAt: value.endsAt };
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The raw stored string, stable between changes, for useSyncExternalStore. */
export function liveLocationNightSnapshot(): string {
  try {
    return storage()?.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function readLiveLocationNight(snapshot = liveLocationNightSnapshot()): LiveLocationNight | null {
  return parse(snapshot || null);
}

export function rememberLiveLocationNight(night: LiveLocationNight): void {
  try {
    const next = JSON.stringify(night);
    if (storage()?.getItem(KEY) === next) return;
    storage()?.setItem(KEY, next);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function forgetLiveLocationNight(planId?: string): void {
  const current = readLiveLocationNight();
  if (planId && current && current.planId !== planId) return;
  try {
    storage()?.removeItem(KEY);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeLiveLocationNight(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) onChange(); };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
