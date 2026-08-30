import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  crewCommittedEventProps,
  sanitizeEvent,
  type AnalyticsEvent,
  type PlanningSource,
} from "@/lib/analyticsEvents";
import {
  crewDeliverySigningKey,
  crewDeliveryVerificationKeys,
  planMutationSigningKey,
  trustedSigningKey,
} from "@/lib/trustedSigningKey.server";

const TOKEN_VERSION_V1 = 1;
const TOKEN_VERSION_V2 = 2;
const TOKEN_V1_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const TOKEN_V2_TTL_MS = 365 * 24 * 60 * 60 * 1_000;
const TOKEN_MAX_LENGTH = 2_000;

type VerifiedAnalyticsClaims = {
  v: typeof TOKEN_VERSION_V1 | typeof TOKEN_VERSION_V2;
  eventId: string;
  name: AnalyticsEvent["name"];
  props: AnalyticsEvent["props"];
  occurredAt: number;
  issuedAt: number;
  expiresAt: number;
};

function canonicalEvent(event: AnalyticsEvent): AnalyticsEvent | null {
  const sanitized = sanitizeEvent(event.name, event.props);
  if (sanitized) {
    const props = Object.fromEntries(Object.entries(sanitized.props).sort(([left], [right]) => left.localeCompare(right)));
    return { name: sanitized.name, props };
  }

  // Compatibility only for the pre-handoff Plan creation response. Its client
  // event is now rejected by sanitizeEvent, so this token can never be ingested;
  // retaining deterministic minting keeps direct/manual Plan creation working
  // until L09 replaces this legacy response contract.
  if (event.name === "plan_accepted"
    && Object.keys(event.props).length === 2
    && Number.isInteger(event.props.stops)
    && typeof event.props.grounded === "boolean") {
    return {
      name: event.name,
      props: { grounded: event.props.grounded, stops: event.props.stops },
    };
  }
  return null;
}

function signature(encoded: string, key: Buffer, version: 1 | 2): Buffer {
  return createHmac("sha256", key).update(`verified-analytics:v${version}:${encoded}`).digest();
}

function eventId(subject: string, event: AnalyticsEvent, key: Buffer): string {
  const hex = createHmac("sha256", key)
    .update(`verified-analytics-event:${subject}:${event.name}:${JSON.stringify(event.props)}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function mintVerifiedAnalyticsToken(
  event: AnalyticsEvent,
  subject: string,
  occurredAt: string,
): string {
  const canonical = canonicalEvent(event);
  const issuedAt = Date.parse(occurredAt);
  if (!canonical || !subject || !Number.isFinite(issuedAt)) throw new Error("Verified analytics needs a canonical event and occurrence.");
  const key = trustedSigningKey();
  const claims = {
    v: TOKEN_VERSION_V1,
    eventId: eventId(subject, canonical, key),
    name: canonical.name,
    props: canonical.props,
    issuedAt,
    expiresAt: issuedAt + TOKEN_V1_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, key, TOKEN_VERSION_V1).toString("base64url")}`;
}

function mintVerifiedAnalyticsTokenV2(
  event: AnalyticsEvent,
  stableEventId: string,
  occurredAt: string,
  issuedAt = Date.now(),
): string {
  const canonical = canonicalEvent(event);
  const occurredAtMs = Date.parse(occurredAt);
  if (!canonical
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stableEventId)
    || !Number.isFinite(occurredAtMs)
    || !Number.isSafeInteger(issuedAt)) {
    throw new Error("Verified analytics needs a canonical event and occurrence.");
  }
  const claims: VerifiedAnalyticsClaims = {
    v: TOKEN_VERSION_V2,
    eventId: stableEventId,
    name: canonical.name,
    props: canonical.props,
    occurredAt: occurredAtMs,
    issuedAt,
    expiresAt: issuedAt + TOKEN_V2_TTL_MS,
  };
  const key = crewDeliverySigningKey();
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, key, TOKEN_VERSION_V2).toString("base64url")}`;
}

export function verifyAnalyticsDeliveryToken(
  token: unknown,
  event: AnalyticsEvent,
  now = Date.now(),
): VerifiedAnalyticsClaims | null {
  if (typeof token !== "string" || !token || token.length > TOKEN_MAX_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<VerifiedAnalyticsClaims>;
    if (parsed.v !== TOKEN_VERSION_V1 && parsed.v !== TOKEN_VERSION_V2) return null;
    if (parsed.name === "crew_committed" && parsed.v !== TOKEN_VERSION_V2) return null;
    if (parsed.v === TOKEN_VERSION_V2 && parsed.name !== "crew_committed") return null;
    const supplied = Buffer.from(parts[1], "base64url");
    const keys = parsed.v === TOKEN_VERSION_V2
      ? crewDeliveryVerificationKeys()
      : [trustedSigningKey()];
    const signatureValid = keys.reduce((valid, key) => {
      const expected = signature(parts[0]!, key, parsed.v as 1 | 2);
      return (supplied.length === expected.length && timingSafeEqual(supplied, expected)) || valid;
    }, false);
    if (!signatureValid) return null;
    const canonical = canonicalEvent(event);
    if (!canonical || typeof parsed.eventId !== "string") return null;
    if (parsed.name !== canonical.name || JSON.stringify(parsed.props) !== JSON.stringify(canonical.props)) return null;
    if (typeof parsed.issuedAt !== "number" || !Number.isSafeInteger(parsed.issuedAt)
      || typeof parsed.expiresAt !== "number" || !Number.isSafeInteger(parsed.expiresAt)) return null;
    const ttl = parsed.v === TOKEN_VERSION_V1 ? TOKEN_V1_TTL_MS : TOKEN_V2_TTL_MS;
    if (parsed.expiresAt !== parsed.issuedAt + ttl || now >= parsed.expiresAt) return null;
    if (parsed.issuedAt > now + 30_000) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.eventId)) return null;
    const occurredAt = parsed.v === TOKEN_VERSION_V1 ? parsed.issuedAt : parsed.occurredAt;
    if (typeof occurredAt !== "number" || !Number.isSafeInteger(occurredAt) || occurredAt > now + 30_000) return null;
    return { ...parsed, occurredAt } as VerifiedAnalyticsClaims;
  } catch {
    return null;
  }
}

export function analyticsDeliveryTokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Provider dedupe key that cannot be joined to the durable receipt UUID. */
export function crewCommittedProviderInsertId(eventId: string): string {
  return createHmac("sha256", planMutationSigningKey())
    .update(`analytics-provider-insert-id:crew_committed:${eventId}`)
    .digest("hex");
}

export function planLoopEventTokens(input: {
  planId: string;
  createdAt: string;
  stops: number;
  grounded: boolean;
}): { planAccepted: string; meaningfulCoreAction: string } {
  return {
    planAccepted: mintVerifiedAnalyticsToken(
      { name: "plan_accepted", props: { stops: input.stops, grounded: input.grounded } },
      `plan:${input.planId}`,
      input.createdAt,
    ),
    // Legacy direct/manual Plan creation is not the trusted three-Stop outcome.
    // Empty compatibility value keeps its response shape stable while making
    // the existing client condition fail closed until L09 emits the V2 token.
    meaningfulCoreAction: "",
  };
}

export function planDraftSavedEventToken(input: {
  planId: string;
  savedAt: string;
  source: PlanningSource;
}): string {
  return mintVerifiedAnalyticsToken(
    {
      name: "plan_draft_saved",
      props: {
        stops: 1,
        grounded: true,
        anchored: true,
        routeReady: false,
        source: input.source,
      },
    },
    `plan:${input.planId}:draft`,
    input.savedAt,
  );
}

export function planAcceptedEventTokens(input: {
  planId: string;
  acceptedAt: string;
  anchored: boolean;
  source: PlanningSource;
}): { planAccepted: string; meaningfulCoreAction: string } {
  return {
    planAccepted: mintVerifiedAnalyticsToken(
      {
        name: "plan_accepted",
        props: {
          stops: 3,
          grounded: true,
          anchored: input.anchored,
          routeReady: true,
          source: input.source,
        },
      },
      `plan:${input.planId}:route-ready`,
      input.acceptedAt,
    ),
    meaningfulCoreAction: mintVerifiedAnalyticsToken(
      { name: "meaningful_core_action", props: { action: "plan_accepted" } },
      `plan:${input.planId}:route-ready:meaningful`,
      input.acceptedAt,
    ),
  };
}

export function crewCommittedEventToken(input: {
  crewCommittedEventId: string;
  crewCommittedAt: string;
  issuedAt?: number;
}): string {
  return mintVerifiedAnalyticsTokenV2(
    {
      name: "crew_committed",
      props: crewCommittedEventProps(),
    },
    input.crewCommittedEventId,
    input.crewCommittedAt,
    input.issuedAt,
  );
}

export function completionLoopEventTokens(input: {
  completionId: string;
  completedAt: string;
  ending: "food" | "get_home" | "keep_going";
}): { planCompleted: string; meaningfulCoreAction: string } {
  return {
    planCompleted: mintVerifiedAnalyticsToken(
      { name: "plan_completed", props: { ending: input.ending } },
      `completion:${input.completionId}`,
      input.completedAt,
    ),
    meaningfulCoreAction: mintVerifiedAnalyticsToken(
      { name: "meaningful_core_action", props: { action: "plan_completed" } },
      `completion:${input.completionId}:meaningful`,
      input.completedAt,
    ),
  };
}
