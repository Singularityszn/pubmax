// The phone half of live location: one watch for the whole app, so sharing
// keeps going when the person moves from their Plan to the map. The browser is
// asked for location only inside startLiveLocationShare, which runs on the
// person's own tap. Nothing here keeps a history: each fix replaces the last.

import { authedFetch } from "@/lib/authedFetch";
import { haversineKm } from "@/lib/haversine";
import { LIVE_LOCATION_HEARTBEAT_MS, LIVE_LOCATION_SEND_MS, type PlanLiveLocationFix } from "@/lib/planLiveLocation";
import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";

export type LiveLocationSeat = { planId: string; via: "plan" | "crew"; memberToken?: string };
/** asking: waiting on the browser. no-signal: the last fix stays up for the crew. */
export type LiveShareStatus = "off" | "asking" | "on" | "no-signal" | "denied" | "unsupported" | "ended" | "failed";
export type LiveShareSnapshot = { planId: string | null; status: LiveShareStatus };

type Request = (seat: LiveLocationSeat, method: "GET" | "PUT" | "DELETE", body?: PlanLiveLocationFix, signal?: AbortSignal) => Promise<Response>;
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
  geolocation: Geolocation;
  request: Request;
  now: () => number;
  watchId: number | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  sent: { at: number; fix: PlanLiveLocationFix } | null;
  pending: PlanLiveLocationFix | null;
  sending: boolean;
};

let session: Session | null = null;
let snapshot: LiveShareSnapshot = { planId: null, status: "off" };
const listeners = new Set<() => void>();

function publish(planId: string | null, status: LiveShareStatus): void {
  if (snapshot.planId === planId && snapshot.status === status) return;
  snapshot = { planId, status };
  for (const listener of listeners) listener();
}

export function subscribeLiveShare(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function liveShareSnapshot(): LiveShareSnapshot {
  return snapshot;
}

function halt(current: Session): void {
  if (current.watchId !== null) current.geolocation.clearWatch(current.watchId);
  if (current.heartbeat !== null) clearInterval(current.heartbeat);
  current.watchId = null;
  current.heartbeat = null;
  if (session === current) session = null;
}

async function send(current: Session, fix: PlanLiveLocationFix): Promise<void> {
  if (current.sending) {
    current.pending = fix;
    return;
  }
  current.sending = true;
  try {
    const response = await current.request(current.seat, "PUT", fix);
    if (session !== current) return;
    if (response.ok) {
      current.sent = { at: current.now(), fix };
      publish(current.seat.planId, "on");
    } else if (response.status === 409 || response.status === 404) {
      halt(current);
      publish(current.seat.planId, response.status === 409 ? "ended" : "failed");
    } else {
      publish(current.seat.planId, "no-signal");
    }
  } catch {
    if (session === current) publish(current.seat.planId, "no-signal");
  } finally {
    current.sending = false;
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
  if (snapshot.status !== "on" && current.sent) publish(current.seat.planId, "on");
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
  const shared = current.sent !== null;
  halt(current);
  publish(current.seat.planId, "denied");
  if (shared) void current.request(current.seat, "DELETE").catch(() => undefined);
}

/** Runs on the person's tap. This is the only place the browser is asked for location. */
export function startLiveLocationShare(seat: LiveLocationSeat, deps: Deps = {}): void {
  const geolocation = deps.geolocation !== undefined ? deps.geolocation
    : typeof navigator !== "undefined" ? navigator.geolocation ?? null : null;
  if (session && session.seat.planId === seat.planId && session.watchId !== null) return;
  if (session) halt(session);
  if (!geolocation) {
    publish(seat.planId, "unsupported");
    return;
  }
  const current: Session = {
    seat, geolocation, request: deps.request ?? liveLocationRequest, now: deps.now ?? Date.now,
    watchId: null, heartbeat: null, sent: null, pending: null, sending: false,
  };
  session = current;
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
  if (session && session.seat.planId === seat.planId) halt(session);
  publish(seat.planId, "off");
  return (deps.request ?? liveLocationRequest)(seat, "DELETE");
}
