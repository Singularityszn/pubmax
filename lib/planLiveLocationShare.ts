// The phone half of live location: one watch for the whole app, so sharing
// keeps going when the person moves from their Plan to the map. The browser is
// asked for location only inside startLiveLocationShare, which runs on the
// person's own tap. Nothing here keeps a history: each fix replaces the last.

import { authedFetch } from "@/lib/authedFetch";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { haversineKm } from "@/lib/haversine";
import { LIVE_LOCATION_HEARTBEAT_MS, LIVE_LOCATION_SEND_MS, type PlanLiveLocationFix } from "@/lib/planLiveLocation";
import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";

export type LiveLocationSeat = { planId: string; via: "plan" | "crew"; memberToken?: string };
/** asking: waiting on the browser. no-signal: the last fix stays up for the crew. */
export type LiveShareStatus = "off" | "busy" | "stopping" | "asking" | "on" | "no-signal" | "denied" | "unsupported" | "ended" | "failed";
export type LiveShareSnapshot = { planId: string | null; status: LiveShareStatus };

type Request = (seat: LiveLocationSeat, method: "GET" | "PUT" | "DELETE", body?: PlanLiveLocationFix & { startAt?: number }, signal?: AbortSignal) => Promise<Response>;
type Deps = { geolocation?: Geolocation | null; request?: Request; now?: () => number };

const PERMISSION_DENIED = 1;
const MOVED_KM = 0.015;
const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 };

/** The private route. A Plan seat rides its HttpOnly cookie; an Open Crew seat rides the account. */
export const liveLocationRequest: Request = (seat, method, body, signal) => {
  const base = `/api/plans/${encodeURIComponent(seat.planId)}/live-location`;
  const init: RequestInit = {
    method, cache: "no-store", credentials: "same-origin", signal,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  if (seat.via === "crew") return authedFetch(`${base}?via=crew`, init, { requiresIdentity: true });
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${seat.memberToken || PLAN_HTTP_ONLY_SESSION}`);
  return fetch(base, { ...init, headers });
};

type Session = {
  seat: LiveLocationSeat;
  ownerSignal: AbortSignal;
  onOwnerChange: () => void;
  geolocation: Geolocation;
  request: Request;
  now: () => number;
  watchId: number | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  sent: { at: number; fix: PlanLiveLocationFix } | null;
  pending: PlanLiveLocationFix | null;
  inFlight: Promise<Response> | null;
  startAt: number | null;
};

let session: Session | null = null;
const stopping = new Map<string, { promise: Promise<Response> | null; onOwnerChange: () => void }>();
const OFF_SNAPSHOT: LiveShareSnapshot = { planId: null, status: "off" };
const snapshots = new Map<string, LiveShareSnapshot>();
const listeners = new Set<() => void>();

function publish(planId: string, status: LiveShareStatus): void {
  if (snapshots.get(planId)?.status === status) return;
  snapshots.set(planId, { planId, status });
  if (!session && !stopping.size) {
    for (const [id, state] of snapshots) {
      if (state.status === "busy") snapshots.delete(id);
    }
  }
  for (const listener of listeners) listener();
}

export function subscribeLiveShare(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function liveShareSnapshot(planId: string): LiveShareSnapshot {
  return snapshots.get(planId) ?? OFF_SNAPSHOT;
}

function halt(current: Session): void {
  current.ownerSignal.removeEventListener("abort", current.onOwnerChange);
  if (current.watchId !== null) current.geolocation.clearWatch(current.watchId);
  if (current.heartbeat !== null) clearInterval(current.heartbeat);
  current.watchId = null;
  current.heartbeat = null;
  current.pending = null;
  if (session === current) session = null;
}

async function send(current: Session, fix: PlanLiveLocationFix): Promise<void> {
  if (current.inFlight) {
    current.pending = fix;
    return;
  }
  try {
    const body = current.startAt !== null ? { ...fix, startAt: current.startAt } : fix;
    current.startAt = null;
    current.inFlight = current.request(current.seat, "PUT", body);
    const response = await current.inFlight;
    if (session !== current) return;
    if (response.ok) {
      current.sent = { at: current.now(), fix };
      publish(current.seat.planId, "on");
    } else if (response.status === 409) {
      const error: unknown = await response.json().catch(() => null);
      if (session !== current) return;
      halt(current);
      publish(current.seat.planId, error && typeof error === "object" && "code" in error
        && error.code === "PLAN_LIVE_LOCATION_STOPPED" ? "off" : "ended");
    } else if (response.status === 404) {
      halt(current);
      publish(current.seat.planId, "failed");
    } else {
      publish(current.seat.planId, "no-signal");
    }
  } catch {
    if (session === current) publish(current.seat.planId, "no-signal");
  } finally {
    current.inFlight = null;
  }
  const next = current.pending;
  current.pending = null;
  if (next && session === current) await send(current, next);
}

function shouldSend(current: Session, fix: PlanLiveLocationFix): boolean {
  if (!current.sent) return true;
  const age = current.now() - current.sent.at;
  if (age >= LIVE_LOCATION_HEARTBEAT_MS) return true;
  const moved = haversineKm([current.sent.fix.longitude, current.sent.fix.latitude], [fix.longitude, fix.latitude]);
  return age >= LIVE_LOCATION_SEND_MS && moved >= MOVED_KM;
}

function onFix(current: Session, position: GeolocationPosition): void {
  if (session !== current) return;
  const fix: PlanLiveLocationFix = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyM: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null,
  };
  if (liveShareSnapshot(current.seat.planId).status !== "on" && current.sent) publish(current.seat.planId, "on");
  if (shouldSend(current, fix)) void send(current, fix);
}

function onError(current: Session, error: GeolocationPositionError): void {
  if (session !== current) return;
  if (error.code !== PERMISSION_DENIED) {
    // A timeout or a lost fix is a blip. The watch keeps running and the crew
    // keeps the last position, labelled with its age.
    publish(current.seat.planId, "no-signal");
    return;
  }
  void stopLiveLocationShare(current.seat).then((response) => {
    if (!current.ownerSignal.aborted && response.ok && liveShareSnapshot(current.seat.planId).status === "off") {
      publish(current.seat.planId, "denied");
    }
  }).catch(() => undefined);
}

/** Runs on the person's tap. This is the only place the browser is asked for location. */
export function startLiveLocationShare(seat: LiveLocationSeat, deps: Deps = {}): void {
  if (stopping.has(seat.planId)) return;
  if ((session && session.seat.planId !== seat.planId) || stopping.size) {
    publish(seat.planId, "busy");
    return;
  }
  const geolocation = deps.geolocation !== undefined ? deps.geolocation
    : typeof navigator !== "undefined" ? navigator.geolocation ?? null : null;
  if (session) return;
  const ownerSignal = readProviderAccountSignal();
  if (!geolocation) {
    publish(seat.planId, "unsupported");
    return;
  }
  const request = deps.request ?? liveLocationRequest;
  const now = deps.now ?? Date.now;
  const current: Session = {
    seat, ownerSignal,
    onOwnerChange: () => {
      halt(current);
      publish(seat.planId, "off");
    },
    geolocation,
    request: (target, method, body) => {
      if (ownerSignal.aborted) return Promise.reject(ownerSignal.reason);
      return request(target, method, body, ownerSignal);
    },
    now,
    watchId: null, heartbeat: null, sent: null, pending: null, inFlight: null, startAt: now(),
  };
  session = current;
  ownerSignal.addEventListener("abort", current.onOwnerChange, { once: true });
  publish(seat.planId, "asking");
  current.watchId = geolocation.watchPosition((position) => onFix(current, position), (error) => onError(current, error), WATCH_OPTIONS);
  // A phone standing still may report nothing. Ask again so the crew sees a fresh dot.
  current.heartbeat = setInterval(() => {
    if (session !== current || (current.sent && current.now() - current.sent.at < LIVE_LOCATION_HEARTBEAT_MS)) return;
    geolocation.getCurrentPosition((position) => onFix(current, position), (error) => onError(current, error), WATCH_OPTIONS);
  }, LIVE_LOCATION_HEARTBEAT_MS);
}

/** Stops the watch and deletes the position for everyone. */
export async function stopLiveLocationShare(seat: LiveLocationSeat, deps: Pick<Deps, "request"> = {}): Promise<Response> {
  const pending = stopping.get(seat.planId);
  if (pending?.promise) return (await pending.promise).clone();
  const current = session?.seat.planId === seat.planId ? session : null;
  const request = current?.request ?? deps.request ?? liveLocationRequest;
  const ownerSignal = readProviderAccountSignal();
  if (pending) ownerSignal.removeEventListener("abort", pending.onOwnerChange);
  if (current) halt(current);
  const stop = {
    promise: null as Promise<Response> | null,
    onOwnerChange: () => {
      if (stopping.get(seat.planId) !== stop) return;
      stopping.delete(seat.planId);
      publish(seat.planId, "off");
    },
  };
  stopping.set(seat.planId, stop);
  ownerSignal.addEventListener("abort", stop.onOwnerChange, { once: true });
  const deletion = (async () => {
    try {
      await current?.inFlight?.catch(() => undefined);
      if (ownerSignal.aborted) throw ownerSignal.reason;
      const response = await request(current?.seat ?? seat, "DELETE", undefined, ownerSignal);
      if (stopping.get(seat.planId) === stop) {
        if (response.ok) {
          stopping.delete(seat.planId);
          ownerSignal.removeEventListener("abort", stop.onOwnerChange);
        } else stop.promise = null;
        publish(seat.planId, response.ok ? "off" : "failed");
      }
      return response;
    } catch (error) {
      if (stopping.get(seat.planId) === stop) {
        stop.promise = null;
        publish(seat.planId, "failed");
      }
      throw error;
    }
  })();
  stop.promise = deletion;
  publish(seat.planId, "stopping");
  return (await deletion).clone();
}
