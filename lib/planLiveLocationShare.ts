// The phone half of live location: one watch for the whole app, so sharing
// keeps going when the person moves from their Plan to the map. The browser is
// asked for location only inside startLiveLocationShare, which runs on the
// person's own tap. Nothing here keeps a history: each fix replaces the last.

import { authedFetch, compositeActionSignal } from "@/lib/authedFetch";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { haversineKm } from "@/lib/haversine";
import { forgetLiveLocationNight } from "@/lib/liveLocationNight";
import { LIVE_LOCATION_HEARTBEAT_MS, LIVE_LOCATION_SEND_MS, parsePlanLiveLocationView, type PlanLiveLocationFix, type PlanLiveLocationView } from "@/lib/planLiveLocation";
import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";

export type LiveLocationSeat = { planId: string; via: "plan" | "crew"; memberToken?: string };
/** asking: waiting on the browser. no-signal: the last fix stays up for the crew. */
export type LiveShareStatus = "off" | "paused" | "busy" | "stopping" | "asking" | "on" | "no-signal" | "denied" | "unsupported" | "ended" | "failed";
export type LiveShareSnapshot = { planId: string | null; status: LiveShareStatus; stopUnconfirmed: boolean };

type Request = (seat: LiveLocationSeat, method: "GET" | "PUT" | "DELETE", body?: PlanLiveLocationFix & { startAt?: number }, signal?: AbortSignal) => Promise<Response>;
type Deps = { geolocation?: Geolocation | null; request?: Request; now?: () => number; endsAt?: string | null };
type Expiry = { endsAt: number | null; expiry: ReturnType<typeof setTimeout> | null };

const PERMISSION_DENIED = 1;
const MOVED_KM = 0.015;
const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 };
const HIDDEN_UPLOAD = new Error("Location upload skipped while hidden");
const STOP_DEADLINE_MS = 8_000;

/** The private route. A Plan seat rides its HttpOnly cookie; an Open Crew seat rides the account. */
export const liveLocationRequest: Request = (seat, method, body, signal) => {
  const base = `/api/plans/${encodeURIComponent(seat.planId)}/live-location`;
  const init: RequestInit = {
    method, cache: "no-store", credentials: "same-origin", signal,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const beforeSend = method === "PUT" ? () => {
    if (document.visibilityState !== "visible") throw HIDDEN_UPLOAD;
  } : undefined;
  if (seat.via === "crew") return authedFetch(`${base}?via=crew`, init, { requiresIdentity: true, beforeSend });
  return authedFetch(base, init, {
    requiresIdentity: false,
    bearerCapability: seat.memberToken || PLAN_HTTP_ONLY_SESSION,
    beforeSend,
  });
};

type Session = Expiry & {
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
const stopping = new Map<string, Expiry & { promise: Promise<Response> | null; ownerSignal: AbortSignal; onOwnerChange: () => void }>();
const OFF_SNAPSHOT: LiveShareSnapshot = { planId: null, status: "off", stopUnconfirmed: false };
const snapshots = new Map<string, { view: LiveShareSnapshot; seat: LiveLocationSeat | null; ownerSignal: AbortSignal }>();
const listeners = new Set<() => void>();

function publish(planId: string, status: LiveShareStatus, seat?: LiveLocationSeat): void {
  const previous = snapshots.get(planId);
  const stopUnconfirmed = stopping.has(planId);
  if (previous?.view.status === status && previous.view.stopUnconfirmed === stopUnconfirmed &&
    (!seat || previous.ownerSignal === readProviderAccountSignal())) return;
  snapshots.set(planId, {
    view: { planId, status, stopUnconfirmed },
    seat: seat ?? previous?.seat ?? null,
    ownerSignal: seat ? readProviderAccountSignal() : previous?.ownerSignal ?? readProviderAccountSignal(),
  });
  if (!session && !stopping.size) {
    for (const [id, state] of snapshots) {
      if (state.view.status === "busy") snapshots.delete(id);
    }
  }
  for (const listener of listeners) listener();
}

export function subscribeLiveShare(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function liveShareSnapshot(planId: string): LiveShareSnapshot {
  return snapshots.get(planId)?.view ?? OFF_SNAPSHOT;
}

export function liveShareCrewStopSeat(): LiveLocationSeat | null {
  const ownerSignal = readProviderAccountSignal();
  for (const snapshot of snapshots.values()) {
    if (snapshot.ownerSignal !== ownerSignal || ownerSignal.aborted || snapshot.seat?.via !== "crew") continue;
    if (["paused", "asking", "on", "no-signal", "failed", "stopping"].includes(snapshot.view.status)) return snapshot.seat;
  }
  return null;
}

function halt(current: Session): void {
  current.ownerSignal.removeEventListener("abort", current.onOwnerChange);
  if (current.watchId !== null) current.geolocation.clearWatch(current.watchId);
  if (current.heartbeat !== null) clearInterval(current.heartbeat);
  if (current.expiry !== null) clearTimeout(current.expiry);
  current.watchId = null;
  current.heartbeat = null;
  current.expiry = null;
  current.pending = null;
  if (session === current) session = null;
}

function endLiveLocationShare(planId: string): void {
  const current = session?.seat.planId === planId ? session : null;
  const stop = stopping.get(planId);
  if (current) halt(current);
  if (stop) {
    if (stop.expiry !== null) clearTimeout(stop.expiry);
    stop.ownerSignal.removeEventListener("abort", stop.onOwnerChange);
    stopping.delete(planId);
  }
  if (typeof window !== "undefined") forgetLiveLocationNight(planId);
  if (current || stop || liveShareSnapshot(planId).status === "paused") publish(planId, "ended");
}

function setExpiry(planId: string, target: Expiry, endsAt: number | null, now = Date.now()): void {
  if (endsAt === null || !Number.isFinite(endsAt)) return;
  if (endsAt <= now) {
    endLiveLocationShare(planId);
    return;
  }
  if (target.endsAt === endsAt && target.expiry !== null) return;
  if (target.expiry !== null) clearTimeout(target.expiry);
  target.endsAt = endsAt;
  target.expiry = setTimeout(() => endLiveLocationShare(planId), endsAt - now);
}

export function reconcileLiveLocationShare(seat: LiveLocationSeat, view: PlanLiveLocationView): void {
  const { planId } = seat;
  if (!view.live) {
    endLiveLocationShare(planId);
    return;
  }
  const target = session?.seat.planId === planId ? session : stopping.get(planId);
  if (target) setExpiry(planId, target, view.endsAt === null ? null : Date.parse(view.endsAt));
  else if (view.sharing) {
    const previous = snapshots.get(planId);
    const ownerSignal = readProviderAccountSignal();
    if (previous?.ownerSignal === ownerSignal && previous.seat &&
      ["paused", "failed"].includes(previous.view.status)) return;
    publish(planId, "paused", seat);
    ownerSignal.addEventListener("abort", () => {
      if (snapshots.get(planId)?.ownerSignal === ownerSignal) publish(planId, "off");
    }, { once: true });
  } else if (liveShareSnapshot(planId).status === "paused") publish(planId, "off");
}

async function send(current: Session, fix: PlanLiveLocationFix): Promise<void> {
  if (document.visibilityState !== "visible") {
    current.pending = null;
    return;
  }
  if (current.inFlight) {
    current.pending = fix;
    return;
  }
  try {
    const body = current.startAt !== null ? { ...fix, startAt: current.startAt } : fix;
    current.inFlight = current.request(current.seat, "PUT", body);
    const response = await current.inFlight;
    if (session !== current) return;
    if (response.ok) {
      current.startAt = null;
      const view = parsePlanLiveLocationView(await response.json().catch(() => null));
      if (session !== current) return;
      if (view) reconcileLiveLocationShare(current.seat, view);
      if (session !== current) return;
      current.sent = { at: current.now(), fix };
      publish(current.seat.planId, "on");
    } else if (response.status === 409) {
      const error: unknown = await response.json().catch(() => null);
      if (session !== current) return;
      if (error && typeof error === "object" && "code" in error && error.code === "PLAN_LIVE_LOCATION_STOPPED") {
        halt(current);
        publish(current.seat.planId, "off");
      } else endLiveLocationShare(current.seat.planId);
    } else if (response.status === 404 || current.startAt !== null) {
      halt(current);
      publish(current.seat.planId, "failed");
    } else {
      publish(current.seat.planId, "no-signal");
    }
  } catch (error) {
    if (error === HIDDEN_UPLOAD) {
      current.pending = null;
      return;
    }
    if (session === current) {
      const failedStart = current.startAt !== null;
      if (failedStart) halt(current);
      publish(current.seat.planId, failedStart ? "failed" : "no-signal");
    }
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
    request: (target, method, body, signal = ownerSignal) => {
      if (ownerSignal.aborted) return Promise.reject(ownerSignal.reason);
      return request(target, method, body, signal);
    },
    now,
    watchId: null, heartbeat: null, sent: null, pending: null, inFlight: null, startAt: now(), endsAt: null, expiry: null,
  };
  session = current;
  ownerSignal.addEventListener("abort", current.onOwnerChange, { once: true });
  setExpiry(seat.planId, current, deps.endsAt ? Date.parse(deps.endsAt) : null, now());
  if (session !== current) return;
  publish(seat.planId, "asking", seat);
  current.watchId = geolocation.watchPosition((position) => onFix(current, position), (error) => onError(current, error), WATCH_OPTIONS);
  // A phone standing still may report nothing. Ask again so the crew sees a fresh dot.
  current.heartbeat = setInterval(() => {
    if (session !== current || document.visibilityState !== "visible" || (current.sent && current.now() - current.sent.at < LIVE_LOCATION_HEARTBEAT_MS)) return;
    geolocation.getCurrentPosition((position) => onFix(current, position), (error) => onError(current, error), WATCH_OPTIONS);
  }, LIVE_LOCATION_HEARTBEAT_MS);
}

/** Stops the watch and deletes the position for everyone. */
export async function stopLiveLocationShare(seat: LiveLocationSeat, deps: Pick<Deps, "request" | "endsAt"> = {}): Promise<Response> {
  const pending = stopping.get(seat.planId);
  if (pending?.promise) return (await pending.promise).clone();
  const current = session?.seat.planId === seat.planId ? session : null;
  const request = current?.request ?? deps.request ?? liveLocationRequest;
  const ownerSignal = readProviderAccountSignal();
  const endsAt = current?.endsAt ?? pending?.endsAt ?? (deps.endsAt ? Date.parse(deps.endsAt) : null);
  if (pending) {
    ownerSignal.removeEventListener("abort", pending.onOwnerChange);
    if (pending.expiry !== null) clearTimeout(pending.expiry);
  }
  if (current) halt(current);
  const stop = {
    promise: null as Promise<Response> | null,
    ownerSignal,
    endsAt: null as number | null,
    expiry: null as ReturnType<typeof setTimeout> | null,
    onOwnerChange: () => {
      if (stopping.get(seat.planId) !== stop) return;
      if (stop.expiry !== null) clearTimeout(stop.expiry);
      stopping.delete(seat.planId);
      publish(seat.planId, "off");
    },
  };
  stopping.set(seat.planId, stop);
  ownerSignal.addEventListener("abort", stop.onOwnerChange, { once: true });
  setExpiry(seat.planId, stop, endsAt);
  const deletion = Promise.resolve().then(async () => {
    const controller = new AbortController();
    const signal = compositeActionSignal([ownerSignal, controller.signal]);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      if (ownerSignal.aborted) throw ownerSignal.reason;
      const timeout = new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => {
          const error = new DOMException("Location Stop timed out.", "TimeoutError");
          controller.abort(error);
          reject(error);
        }, STOP_DEADLINE_MS);
      });
      const response = await Promise.race([
        request(current?.seat ?? seat, "DELETE", undefined, signal),
        timeout,
      ]);
      if (stopping.get(seat.planId) === stop) {
        if (response.ok) {
          if (stop.expiry !== null) clearTimeout(stop.expiry);
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
    } finally {
      clearTimeout(deadline);
    }
  });
  stop.promise = deletion;
  if (stopping.get(seat.planId) === stop) publish(seat.planId, "stopping", current?.seat ?? seat);
  return (await deletion).clone();
}

export async function stopLiveLocationBeforeAccountDeparture(): Promise<void> {
  const ownerSignal = readProviderAccountSignal();
  const seats = [...snapshots.values()]
    .filter((snapshot) => snapshot.ownerSignal === ownerSignal && snapshot.seat &&
      ["paused", "asking", "on", "no-signal", "failed", "stopping"].includes(snapshot.view.status))
    .map((snapshot) => snapshot.seat!);
  await Promise.allSettled(seats.map((seat) => stopLiveLocationShare(seat)));
}
