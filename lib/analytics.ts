// Client-side event beacon (Wave D · D0). One entry point — trackEvent — that
// the whole app uses to record a self-owned, privacy-first signal. This
// replaces the earlier Vercel Analytics-backed rail (R3); the same closed set
// of ~10 named events those cycle metrics depend on now lives in the shared
// registry (lib/analyticsEvents.ts) instead of a third-party `track()` call,
// so every existing caller (badge_tap, booking_click, tour_complete, etc.)
// keeps working unchanged.
//
// Privacy-first: honours Do-Not-Track, sends only registry-known events with
// allow-listed primitive props (validated again here as defence in depth), and
// carries a stable pseudonymous identifier only after explicit analytics
// consent; without consent the server does not forward the event to PostHog.
// Ordinary events use sendBeacon/keepalive and stay fire-and-forget. Server-
// verified acceptance/completion outcomes use a bounded, consent-cleared local
// outbox and acknowledged keepalive fetch so lost responses can be retried
// safely against the durable dedupe receipt.

import {
  sanitizeEvent,
  type AnalyticsEventName,
  type AnalyticsProps,
  type WeeklyMeaningfulCoreAction,
} from "@/lib/analyticsEvents";
import {
  ANONYMOUS_ANALYTICS_STORAGE_KEY,
  ANALYTICS_CONSENT_STORAGE_KEY,
  isAnonymousAnalyticsId,
} from "@/lib/analyticsIdentity";

const ENDPOINT = "/api/events";
const VERIFIED_OUTBOX_KEY = "pubmaxx:analytics-verified-outbox:v1";
let inMemoryAnonymousId: string | null = null;
let inMemoryConsentGranted = false;
const inMemoryVerifiedOutbox = new Map<string, string>();
let verifiedFlush: Promise<void> | null = null;
let verifiedFlushAbort: AbortController | null = null;
let analyticsConsentEpoch = 0;

type TrackEventOptions = { deliveryToken?: string };

function persistedVerifiedOutbox(): Map<string, string> {
  const items = new Map(inMemoryVerifiedOutbox);
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VERIFIED_OUTBOX_KEY) ?? "[]") as unknown;
    if (Array.isArray(parsed)) {
      for (const row of parsed.slice(-20)) {
        if (!row || typeof row !== "object") continue;
        const token = (row as { token?: unknown }).token;
        const payload = (row as { payload?: unknown }).payload;
        if (typeof token === "string" && typeof payload === "string") items.set(token, payload);
      }
    }
  } catch { /* in-memory retry still works for this page lifetime */ }
  return items;
}

function writeVerifiedOutbox(items: Map<string, string>): void {
  inMemoryVerifiedOutbox.clear();
  for (const [token, payload] of [...items.entries()].slice(-20)) inMemoryVerifiedOutbox.set(token, payload);
  try {
    window.localStorage.setItem(
      VERIFIED_OUTBOX_KEY,
      JSON.stringify([...inMemoryVerifiedOutbox].map(([token, payload]) => ({ token, payload }))),
    );
  } catch { /* in-memory queue remains */ }
}

function clearVerifiedOutbox(): void {
  inMemoryVerifiedOutbox.clear();
  try { window.localStorage.removeItem(VERIFIED_OUTBOX_KEY); } catch { /* best effort */ }
}

function removeVerifiedOutboxItem(token: string): void {
  const current = persistedVerifiedOutbox();
  current.delete(token);
  writeVerifiedOutbox(current);
}

export async function flushVerifiedAnalyticsOutbox(): Promise<void> {
  if (verifiedFlush) return verifiedFlush;
  if (typeof window === "undefined" || !analyticsCollectionAllowed()) return;
  const epoch = analyticsConsentEpoch;
  const controller = new AbortController();
  verifiedFlushAbort = controller;
  const active = () => (
    epoch === analyticsConsentEpoch
    && !controller.signal.aborted
    && analyticsCollectionAllowed()
  );
  const run = (async () => {
    if (!active()) return;
    const items = persistedVerifiedOutbox();
    for (const [token, payload] of items) {
      if (!active()) return;
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
          signal: controller.signal,
        });
        if (!active()) return;
        const status = response.headers.get("x-analytics-delivery");
        if (response.ok && (status === "delivered" || status === "discard")) {
          if (!active()) return;
          removeVerifiedOutboxItem(token);
        }
      } catch { /* retain for the next mount or event */ }
    }
  })();
  verifiedFlush = run;
  void run.finally(() => {
    if (verifiedFlush === run) verifiedFlush = null;
    if (verifiedFlushAbort === controller) verifiedFlushAbort = null;
  });
  return run;
}

function newAnonymousAnalyticsId(): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `anon_${random}`;
}

/**
 * Stable, pseudonymous keyless funnel id. It contains no account, handle,
 * contact, or location data and is never created during server rendering.
 */
export function anonymousAnalyticsId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    if (window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY) !== "granted") return null;
    inMemoryConsentGranted = true;
    const existing = window.localStorage.getItem(ANONYMOUS_ANALYTICS_STORAGE_KEY);
    if (isAnonymousAnalyticsId(existing)) return existing;
    const created = newAnonymousAnalyticsId();
    window.localStorage.setItem(ANONYMOUS_ANALYTICS_STORAGE_KEY, created);
    return created;
  } catch {
    if (!inMemoryConsentGranted) return null;
    if (!inMemoryAnonymousId) inMemoryAnonymousId = newAnonymousAnalyticsId();
    return inMemoryAnonymousId;
  }
}

export function setAnalyticsConsent(granted: boolean): void {
  if (typeof window === "undefined") return;
  // Every consent transition invalidates snapshots captured by an older
  // flush. Abort immediately, then let the epoch checks prevent a fetch that
  // ignored abort from sending the next item or mutating a re-granted queue.
  analyticsConsentEpoch += 1;
  verifiedFlushAbort?.abort();
  verifiedFlushAbort = null;
  verifiedFlush = null;
  try {
    if (granted) {
      inMemoryConsentGranted = true;
      window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "granted");
      void flushVerifiedAnalyticsOutbox();
    } else {
      inMemoryConsentGranted = false;
      window.localStorage.removeItem(ANALYTICS_CONSENT_STORAGE_KEY);
      window.localStorage.removeItem(ANONYMOUS_ANALYTICS_STORAGE_KEY);
      inMemoryAnonymousId = null;
      clearVerifiedOutbox();
    }
  } catch {
    inMemoryConsentGranted = granted;
    if (!granted) {
      inMemoryAnonymousId = null;
      clearVerifiedOutbox();
    }
  }
}

function doNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { doNotTrack?: string };
  const win = typeof window !== "undefined"
    ? (window as Window & { doNotTrack?: string })
    : undefined;
  const dnt = nav.doNotTrack ?? win?.doNotTrack;
  return dnt === "1" || dnt === "yes";
}

/**
 * One consent gate shared by the self-owned event rail and Vercel pageviews.
 * It never creates an identifier and fails closed when browser storage is
 * unavailable unless the person explicitly granted consent in this session.
 */
export function analyticsCollectionAllowed(): boolean {
  if (typeof window === "undefined" || doNotTrack()) return false;
  try {
    return window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY) === "granted";
  } catch {
    return inMemoryConsentGranted;
  }
}

/**
 * Record a product event. No-ops on the server, under Do-Not-Track, or for an
 * unknown/invalid event name. Never throws.
 */
export function trackEvent(
  name: AnalyticsEventName,
  props?: AnalyticsProps,
  options?: TrackEventOptions,
): void {
  try {
    if (typeof window === "undefined") return;
    if (!analyticsCollectionAllowed()) return;
    const event = sanitizeEvent(name, props);
    if (!event) return;

    const anonymousId = anonymousAnalyticsId();
    if (!anonymousId) return;
    const payload = JSON.stringify({
      name: event.name,
      props: event.props,
      path: window.location?.pathname ?? null,
      anonymousId,
      analyticsConsent: true,
      ...(options?.deliveryToken ? { deliveryToken: options.deliveryToken } : {}),
      ts: Date.now(),
    });

    if (options?.deliveryToken) {
      if (options.deliveryToken.length > 2_000) return;
      const items = persistedVerifiedOutbox();
      items.set(options.deliveryToken, payload);
      writeVerifiedOutbox(items);
      if (verifiedFlush) {
        void verifiedFlush.then(() => flushVerifiedAnalyticsOutbox());
      } else {
        void flushVerifiedAnalyticsOutbox();
      }
      return;
    }

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
    // Fallback: keepalive fetch (still fire-and-forget).
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics must never break a flow */
  }
}

/**
 * Record one of the reviewed actions that qualifies a person for Weekly
 * Meaningful Pubmaxxers. Call this only beside the confirmed primary loop
 * event; keeping the roll-up separate makes the metric definition queryable
 * without treating route generation, claim steps, or passive views as value.
 */
export function trackMeaningfulCoreAction(action: WeeklyMeaningfulCoreAction, deliveryToken?: string): void {
  trackEvent("meaningful_core_action", { action }, deliveryToken ? { deliveryToken } : undefined);
}

// ---------------------------------------------------------------------------
// lane_to_plan provenance (R3)
//
// `lane_to_plan` must only count plan creations that genuinely started on a
// What's-On / Tonight lane surface — otherwise it is indistinguishable from
// `plan_created` and reports conversions that never involved a lane. Lane
// surfaces link to the composer with `?src=<lane source>` (W1 Tonight-surface
// work adds `?src=tonight-lane`); anything else yields null and the event
// stays silent. Honest zero > invented signal.

/**
 * Exact allowlist of canonical `src` tokens that count as a lane surface for
 * `lane_to_plan`. EXACT matching only — never prefix matching — so a crafted
 * link like `/plan?src=whats-on-jane.doe@example.com` can never push raw
 * query text (potential PII / free text) into telemetry. Grow this set as
 * lane surfaces ship (W1 Tonight lane, What's-On verticals).
 */
const LANE_SOURCES = new Set([
  "tonight-lane",
  "whats-on-quiz",
  "whats-on-sport",
  "whats-on-deal",
  "whats-on-music",
]);

/**
 * Extract lane provenance from a location search string (e.g.
 * "?src=tonight-lane"). Returns the matched canonical token only when the
 * `src` value is EXACTLY one of the allowlisted lane sources; null otherwise
 * (missing, empty, unknown, or prefix-extended src → no event). Raw query
 * text is never forwarded into telemetry.
 */
export function laneSourceFromSearch(search: string): string | null {
  let src: string | null;
  try {
    src = new URLSearchParams(search).get("src");
  } catch {
    return null;
  }
  return src !== null && LANE_SOURCES.has(src) ? src : null;
}
