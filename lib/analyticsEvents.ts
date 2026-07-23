// The self-owned analytics event set (Wave D · D0). One registry, shared by the
// client beacon (lib/analytics.ts) and the ingest route (app/api/events), so
// both agree on which events exist and which props each may carry.
//
// Privacy-first by construction: no account identifiers and no free text.
// PostHog receives only this sanitized contract, with a stable pseudonymous id
// available solely after analytics consent. Every event is a fixed name and
// its props are a small allow-list of low-cardinality primitives — anything
// else is dropped before it can leave the device or land in the log. This keeps
// the "measurement spine" the other waves draw their success signals from
// honest and PII-free even as new events are added.

import {
  COVERAGE_STATUSES,
  NIGHT_AREA_SLUGS,
  ROUTE_READY_GATE_CODES,
  ROUTE_READY_GATE_VERSION,
} from "@/lib/nightAreas";

/** Allowed prop keys per event. An empty list means the event carries no props. */
export const ANALYTICS_EVENTS = {
  // R3 cycle metrics rail (carried over from the original Vercel-backed
  // trackEvent; ported onto this self-owned registry so the same closed set
  // of ~10 named events keeps working under the D0 beacon).
  badge_tap: [],
  lane_card_tap: [],
  lane_to_plan: ["source", "stops"],
  cmdk_open: [],
  night_mode_active: [],
  drop_logged: [],
  booking_click: ["tier"],
  whats_on_filter: [],
  // Wave F · F3 — concierge-as-map-home
  concierge_ask: [],
  concierge_result_tap: [],
  tour_complete: ["completed"],
  plan_created: ["count"],
  night_description_submitted: ["area", "daypart"],
  planned_night_status_changed: ["status"],
  planned_night_action: ["type"],
  pub_pal_adopted: ["pal"],
  pub_pal_summoned: ["surface"],
  pub_pal_memory_changed: ["action", "category"],
  discovery_viewed: ["surface", "daypart"],
  plan_invite_sent: ["channel"],
  plan_invite_opened: ["source"],
  crew_committed: ["source", "participants"],
  account_claimed: ["source"],
  social_account_connected: ["provider", "connectionType"],
  night_moment_saved: ["kind", "visibility"],
  night_memory_created: ["source"],
  night_story_published: ["contributors", "moments"],
  // Recap page (Cycle 9). Sharing is a return-loop signal; the gate event marks
  // a crew stepping toward the consent flow, never a publish itself.
  recap_shared: ["channel", "planId"],
  recap_share_gate_opened: ["planId"],
  next_night_committed: ["windowDays", "source"],
  draft_recovered: ["kind", "surface"],
  web_vital: ["metric", "value", "rating"],
  guest_plan_participated: ["action"],
  // Wave A
  tonight_screen_view: [],
  tonight_filter_select: ["kind"],
  // Vibe layer (docs/VIBE_LAYER_SPEC_2026-07-19.md): which mood chip was
  // pressed. The vibe id only — never free text, never location.
  tonight_vibe_select: ["vibe"],
  // Plan-page crew vibe vote (share-loop tally). Same contract: chip id only.
  plan_vibe_vote: ["vibe"],
  event_chip_view: ["kind"],
  // Wave D — sharing is a return-loop signal; alcohol quantity is never
  // represented as progression telemetry.
  poster_shared: ["surface"],
  // London Capture — reviewed catalogue identifiers and gate codes only.
  district_catalogue_viewed: [],
  district_viewed: ["district", "coverageStatus", "demandWave"],
  district_route_blocked: ["district", "coverageStatus", "demandWave", "reason"],
  district_route_ready_selected: ["district", "coverageStatus", "demandWave"],
  route_ready_gate_failed: ["district", "coverageStatus", "demandWave", "reason", "gateVersion"],
  // Metrics funnel (Wave M) — nights planned/week reuses plan_created (create)
  // and crew_committed (join, source: "shared-plan") from R3/Wave F above; see
  // docs/METRICS_FUNNEL.md for the full computation. The events below are new.
  //
  // Invites per planner — invite_created (host mints a link) and
  // invite_redeemed (a guest actually unlocks collaboration on it) share the
  // invite's own row id, which is an opaque, non-secret database identifier
  // (never the raw invite token/capability) — safe to join on for k-factor.
  invite_created: ["inviteId"],
  invite_redeemed: ["inviteId"],
  // Return rate (daily basis) — one coarse, low-cardinality signal per
  // identity per UTC calendar day (days-since-epoch, deduped client-side
  // before it is ever sent). No timestamp, no session length, no fingerprint.
  activity_pulse: ["dayBucket"],
  // A2HS installs — beforeinstallprompt eligibility, the appinstalled
  // completion event (Android/Chrome), and standalone display-mode at launch
  // as the iOS-compatible proxy for "already installed". No props needed.
  // "platform" registered per the C8 drift note: #313's A2HS surface emits
  // { platform: "android" | "ios-safari" } — without the allow-listed prop the
  // sanitizer would strip it.
  pwa_install_prompt_available: ["platform"],
  pwa_install_completed: ["platform"],
  pwa_standalone_launch: ["platform"],
  // Native shell (Capacitor) — contextual push pre-permission explainer.
  native_push_prompt_enable: [],
  native_push_prompt_later: [],
  // Wave 0.5 loop metrics. These names describe confirmed product outcomes,
  // not page views. Props stay deliberately coarse: no Plan/Memory/Story ids,
  // user content, locations, coordinates, or elapsed-time fingerprints.
  plan_generated: ["stops", "grounded"],
  plan_accepted: ["stops", "grounded"],
  plan_saved: ["stops", "grounded"],
  claim_started: ["source"],
  claim_completed: ["source"],
  plan_completed: ["ending"],
  memory_reviewed: ["source"],
  story_published: ["visibility", "contributors", "moments"],
  // One roll-up event gives Reach a stable denominator in PostHog. Only the
  // explicit loop actions below qualify; route generation, claim steps, and
  // passive opens never do.
  meaningful_core_action: ["action"],
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

export const WEEKLY_MEANINGFUL_CORE_ACTIONS = [
  "plan_accepted",
  "plan_saved",
  "plan_completed",
  "memory_reviewed",
  "story_published",
] as const satisfies readonly AnalyticsEventName[];

export type WeeklyMeaningfulCoreAction = (typeof WEEKLY_MEANINGFUL_CORE_ACTIONS)[number];

export type AnalyticsProps = Record<string, string | number | boolean>;

/** A validated, ready-to-send event. */
export type AnalyticsEvent = {
  name: AnalyticsEventName;
  props: AnalyticsProps;
};

const MAX_STRING_LEN = 40;

const SAFE_STRING_VALUES = new Set([
  // fixed product surfaces and provenance
  "landing", "home", "map", "tonight", "plan", "you", "pal", "borough", "crawl", "recap",
  "shared-plan", "plan-link", "crew-reinvite", "completed_plan",
  "tonight-lane", "whats-on-quiz", "whats-on-sport", "whats-on-deal", "whats-on-music",
  // fixed actions, states, providers, and fallbacks
  "copy", "native", "whatsapp", "sms", "x", "instagram", "tiktok", "oauth", "manual",
  "draft", "ready", "active", "ending", "completed", "abandoned",
  "arrived", "skipped", "swapped", "food_preview", "get_home_preview", "keep_going_preview",
  "food", "get_home", "keep_going", "hound", "raven", "fox",
  "create", "edit", "delete", "approve", "reject", "preference", "correction", "outcome",
  // reviewed domain enums
  "daytime", "after_work", "evening", "late_night", "morning", "afternoon", "night",
  "sport", "quiz", "deal", "music", "gig",
  "photo", "pint_drop", "pint-drop", "event", "venue", "quote", "person", "side_quest",
  "private", "unlisted", "public", "friends", "legacy", "anonymous",
  "direct", "site", "search",
  // A2HS platform values (#313): fixed enum, no UA strings
  "android", "ios-safari", "standalone", "unsupported",
  "CLS", "FCP", "INP", "LCP", "TTFB", "good", "needs-improvement", "poor",
  // Wave 0.5 fixed loop vocabulary.
  "auth", "inline_recap", "full_recap",
  "plan_accepted", "plan_saved", "plan_completed", "memory_reviewed", "story_published",
  ...NIGHT_AREA_SLUGS,
  ...COVERAGE_STATUSES,
  ...ROUTE_READY_GATE_CODES,
]);

const DISTRICT_EVENT_PROP_VALUES = {
  district: NIGHT_AREA_SLUGS,
  coverageStatus: COVERAGE_STATUSES,
  demandWave: [0, 1, 2, 3],
  reason: ROUTE_READY_GATE_CODES,
  gateVersion: [ROUTE_READY_GATE_VERSION],
} as const;

function isAllowedDistrictEventProp(name: AnalyticsEventName, key: string, value: string | number | boolean): boolean {
  if (!name.startsWith("district_") && name !== "route_ready_gate_failed") return true;
  const allowed = DISTRICT_EVENT_PROP_VALUES[key as keyof typeof DISTRICT_EVENT_PROP_VALUES];
  return !allowed || (allowed as readonly (string | number | boolean)[]).includes(value);
}

function isAllowedLoopEventProp(name: AnalyticsEventName, key: string, value: string | number | boolean): boolean {
  if (["plan_generated", "plan_accepted", "plan_saved"].includes(name)) {
    if (key === "stops") return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
    if (key === "grounded") return typeof value === "boolean";
  }
  if ((name === "claim_started" || name === "claim_completed") && key === "source") return value === "auth";
  if (name === "plan_completed" && key === "ending") {
    return typeof value === "string" && ["food", "get_home", "keep_going"].includes(value);
  }
  if (name === "memory_reviewed" && key === "source") {
    return typeof value === "string" && ["inline_recap", "full_recap"].includes(value);
  }
  if (name === "story_published") {
    if (key === "visibility") return typeof value === "string" && ["public", "unlisted"].includes(value);
    if (key === "contributors" || key === "moments") {
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
    }
  }
  if (name === "meaningful_core_action" && key === "action") {
    return typeof value === "string" && (WEEKLY_MEANINGFUL_CORE_ACTIONS as readonly string[]).includes(value);
  }
  return true;
}

// UUID-shaped values (e.g. a plan invite's own row id) are the one exception
// to the fixed-enum string allowlist below: they are opaque, non-secret,
// server-generated identifiers — never free text, never the raw invite
// token/capability — so a format check is enough to keep them PII-free.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidLike(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Per-prop-key validators that replace the generic enum check for that key. */
const CUSTOM_PROP_VALIDATORS: Partial<Record<string, (value: unknown) => value is string | number | boolean>> = {
  inviteId: isUuidLike,
};

export function isKnownEvent(name: string): name is AnalyticsEventName {
  return Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, name);
}

/**
 * A prop value is safe only when it is a low-cardinality primitive: a short
 * string with no "@" (a cheap guard against emails / handles slipping in), a
 * finite number, or a boolean. Everything else is rejected.
 */
function isSafeValue(value: unknown): value is string | number | boolean {
  if (typeof value === "string") {
    return value.length > 0
      && value.length <= MAX_STRING_LEN
      && !value.includes("@")
      && SAFE_STRING_VALUES.has(value);
  }
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= 600_000;
  return typeof value === "boolean";
}

/**
 * Validate + narrow an event to exactly what the registry permits. Unknown
 * event names return null; unknown or unsafe prop keys/values are dropped
 * silently so a bad prop never blocks a legitimate event. The result is safe to
 * both send from the client and persist server-side.
 */
export function sanitizeEvent(
  name: string,
  props?: Record<string, unknown> | null,
): AnalyticsEvent | null {
  if (!isKnownEvent(name)) return null;
  const allowedKeys = ANALYTICS_EVENTS[name] as readonly string[];
  const out: AnalyticsProps = {};
  if (props && typeof props === "object") {
    for (const key of allowedKeys) {
      const value = (props as Record<string, unknown>)[key];
      if (value === undefined) continue;
      const customValidator = CUSTOM_PROP_VALIDATORS[key];
      const valid = customValidator
        ? customValidator(value)
        : isSafeValue(value)
          && isAllowedDistrictEventProp(name, key, value)
          && isAllowedLoopEventProp(name, key, value);
      if (valid) out[key] = value as string | number | boolean;
    }
  }
  // The roll-up is meaningful only with its exact reviewed action. Unlike
  // ordinary optional props, a missing/invalid discriminator must reject the
  // whole event so ingest can never record an ambiguous core action.
  if (name === "meaningful_core_action" && out.action === undefined) return null;
  return { name, props: out };
}
