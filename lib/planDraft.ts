import { parsePlanIntakeRequest, type PlanIntakeDraft } from "@/lib/planIntake";
import { cleanPlanStopCountSource, isPlanStopCount, type PlanStopCount, type PlanStopCountSource } from "@/lib/planStopCount";
import { cleanNightContextPatch, type NightContext } from "@/lib/nightPlanning";
import { DAY_MS } from "@/lib/dayMs";
import { CITIES, type CityId } from "@/lib/cities";
import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import { PLANNING_INTENT_SOURCES, type PlanningIntentArea, type PlanningIntentSource } from "@/lib/planningIntent";

export const PLAN_DRAFT_KEY = "pubmaxx:plan-draft:v1";
export const PLAN_DRAFT_V2_KEY = "pubmax:plan-draft:v2";
const PLAN_DRAFT_STORAGE_VERSION = 2 as const;
const PLAN_DRAFT_MAX_RAW_BYTES = 20 * 1024;
export const PLAN_DRAFT_TTL_MS = DAY_MS;
const PLAN_DRAFT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const PLAN_DRAFT_ORIGINS = [
  "manual",
  "template",
  "planning-intent",
] as const;

export type PlanDraftOrigin = (typeof PLAN_DRAFT_ORIGINS)[number];

export type StoredPlanDraft = {
  title: string;
  creatorName: string;
  startTime: string;
  conciergeQuery: string;
  stops: Array<{ key: number; venueId: string; venueName: string }>;
  /** Stop 1 belongs to a request that has no generated route yet. */
  provisionalStop?: true;
  /** The existing Session write time, retained for ordering this request in V1. */
  provisionalSavedAt?: string;
  explicitNightContext?: Partial<NightContext>;
  requestIntake?: PlanIntakeDraft;
  entryMode?: "wizard";
  requestedStopCount?: PlanStopCount;
  requestedStopCountSource?: PlanStopCountSource;
  routeReference?: { savedAt: string; operationKey: string } | null;
  acceptedAnchor?: {
    venueId: string;
    source: PlanningIntentSource;
    cityId: CityId | null;
    acceptedArea: PlanningIntentArea;
    startsAt: string | null;
    expiresAt: string;
  };
};

type PlanDraftEnvelopeV2 = {
  storageVersion: typeof PLAN_DRAFT_STORAGE_VERSION;
  savedAt: string;
  expiresAt: string;
  origin: PlanDraftOrigin;
  draft: StoredPlanDraft;
};

export type ParsedPlanDraft = {
  storageVersion: 1 | typeof PLAN_DRAFT_STORAGE_VERSION;
  savedAt: string | null;
  expiresAt: string | null;
  origin: PlanDraftOrigin;
  draft: StoredPlanDraft;
  legacy: boolean;
};

export type PlanDraftStorage = Pick<Storage, "getItem" | "setItem">;

export type PlanDraftWriteResult = {
  v1: boolean;
  v2: boolean;
  envelope: PlanDraftEnvelopeV2 | null;
};

const ENVELOPE_KEYS = [
  "storageVersion",
  "savedAt",
  "expiresAt",
  "origin",
  "draft",
] as const;
const DRAFT_KEYS = [
  "title",
  "creatorName",
  "startTime",
  "conciergeQuery",
  "stops",
] as const;
const DRAFT_KEYS_WITH_ANCHOR = [...DRAFT_KEYS, "acceptedAnchor"] as const;
const STOP_KEYS = ["key", "venueId", "venueName"] as const;
const LEGACY_ACCEPTED_ANCHOR_KEYS = ["venueId", "source", "cityId", "acceptedArea", "startsAt"] as const;
const ACCEPTED_ANCHOR_KEYS = ["venueId", "source", "cityId", "acceptedArea", "startsAt", "expiresAt"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function canonicalTimestamp(value: unknown): { value: string; time: number } | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) return null;
  return { value, time };
}

function parseAcceptedArea(area: unknown): PlanningIntentArea | undefined {
  return area === null
    ? null
    : isRecord(area)
      && ((hasExactKeys(area, ["kind", "id"]) && area.kind === "night-patch" && typeof area.id === "string" && NIGHT_PATCHES.some((patch) => patch.id === area.id))
        || (hasExactKeys(area, ["kind", "name"]) && area.kind === "borough" && typeof area.name === "string" && LONDON_BOROUGHS.includes(area.name)))
        ? area as PlanningIntentArea
        : undefined;
}

function hasDraftKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).filter((key) => key !== "requestedStopCount" && key !== "requestedStopCountSource"
    && key !== "routeReference" && key !== "explicitNightContext" && key !== "requestIntake"
    && key !== "entryMode" && key !== "provisionalStop" && key !== "provisionalSavedAt");
  return [DRAFT_KEYS, DRAFT_KEYS_WITH_ANCHOR].some((allowed) =>
    keys.length === allowed.length && keys.every((key) => (allowed as readonly string[]).includes(key)));
}

export function parsePlanRouteReference(value: unknown): StoredPlanDraft["routeReference"] {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["savedAt", "operationKey"])) return undefined;
  const savedAt = canonicalTimestamp(value.savedAt)?.value;
  const operationKey = boundedText(value.operationKey, 120);
  return savedAt && operationKey?.trim() === operationKey && operationKey
    ? { savedAt, operationKey } : undefined;
}

export function parsePlanExplicitNightContext(value: unknown): Partial<NightContext> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.stopCount !== undefined && !isPlanStopCount(value.stopCount)) return undefined;
  const patch = cleanNightContextPatch(value);
  if (!patch || Object.keys(value).some((key) => value[key] !== undefined && !Object.hasOwn(patch, key))) return undefined;
  return patch;
}

function parseRequestOptions(value: Record<string, unknown>, now: number): Pick<StoredPlanDraft, "requestedStopCount" | "requestedStopCountSource" | "routeReference" | "explicitNightContext" | "requestIntake" | "entryMode"> {
  const count = isPlanStopCount(value.requestedStopCount) ? value.requestedStopCount : undefined;
  const source = cleanPlanStopCountSource(value.requestedStopCountSource, count);
  const routeReference = parsePlanRouteReference(value.routeReference);
  const explicitNightContext = parsePlanExplicitNightContext(value.explicitNightContext);
  const requestIntake = parsePlanIntakeRequest(value.requestIntake, now);
  return {
    ...(explicitNightContext !== undefined ? { explicitNightContext } : {}),
    ...(requestIntake ? { requestIntake } : {}),
    ...(value.entryMode === "wizard" ? { entryMode: "wizard" as const } : {}),
    ...(count !== undefined ? { requestedStopCount: count } : {}),
    ...(source ? { requestedStopCountSource: source } : {}),
    ...(routeReference !== undefined ? { routeReference } : {}),
  };
}

function parseProvisionalStop(
  value: Record<string, unknown>,
  stops: ReadonlyArray<{ venueId: string } | null>,
  now: number,
): Pick<StoredPlanDraft, "provisionalStop" | "provisionalSavedAt"> | null {
  if (value.provisionalStop === undefined) return value.provisionalSavedAt === undefined ? {} : null;
  if (value.provisionalStop !== true || stops.length !== 1 || !stops[0]?.venueId.trim()
    || (value.routeReference !== undefined && value.routeReference !== null)) return null;
  const savedAt = canonicalTimestamp(value.provisionalSavedAt);
  return savedAt && savedAt.time <= now + PLAN_DRAFT_MAX_FUTURE_SKEW_MS
    ? { provisionalStop: true, provisionalSavedAt: savedAt.value } : null;
}

function parseStoredPlanDraft(value: unknown, exactKeys: boolean, now: number): StoredPlanDraft | null {
  if (
    !isRecord(value)
    || (exactKeys && !hasDraftKeys(value))
  ) return null;
  const title = boundedText(value.title, 200);
  const creatorName = boundedText(value.creatorName, 100);
  const startTime = boundedText(value.startTime, 40);
  const conciergeQuery = boundedText(value.conciergeQuery, 500);
  if (title === null || creatorName === null || startTime === null || conciergeQuery === null) return null;
  if (!Array.isArray(value.stops) || value.stops.length > 12) return null;
  // A request without stops may revoke a route, but cannot bind to one or hold a pub.
  if (value.stops.length === 0 && (value.acceptedAnchor !== undefined || parsePlanRouteReference(value.routeReference))) return null;

  const stops = value.stops.map((candidate, index) => {
    if (
      !isRecord(candidate)
      || (exactKeys && (!hasExactKeys(candidate, STOP_KEYS) || candidate.key !== index + 1))
    ) return null;
    const venueId = boundedText(candidate.venueId, 200);
    const venueName = boundedText(candidate.venueName, 200);
    if (venueId === null || venueName === null) return null;
    return { key: index + 1, venueId, venueName };
  });
  if (stops.some((stop) => stop === null)) return null;
  const provisional = parseProvisionalStop(value, stops, now);
  if (!provisional) return null;
  const options = { ...parseRequestOptions(value, now), ...provisional };
  let acceptedAnchor: StoredPlanDraft["acceptedAnchor"];
  if (value.acceptedAnchor !== undefined) {
    const anchor = value.acceptedAnchor;
    if (!isRecord(anchor)) return null;
    if (hasExactKeys(anchor, LEGACY_ACCEPTED_ANCHOR_KEYS)) {
      return {
        title,
        creatorName,
        startTime,
        conciergeQuery,
        stops: stops as StoredPlanDraft["stops"],
        ...options,
      };
    }
    if (!hasExactKeys(anchor, ACCEPTED_ANCHOR_KEYS)) return null;
    const venueId = boundedText(anchor.venueId, 200);
    const source = typeof anchor.source === "string" && (PLANNING_INTENT_SOURCES as readonly string[]).includes(anchor.source)
      ? anchor.source as PlanningIntentSource
      : null;
    const cityId = anchor.cityId === null
      ? null
      : typeof anchor.cityId === "string" && Object.hasOwn(CITIES, anchor.cityId)
        ? anchor.cityId as CityId
        : undefined;
    const startsAt = anchor.startsAt === null ? null : canonicalTimestamp(anchor.startsAt)?.value;
    const expiresAt = canonicalTimestamp(anchor.expiresAt)?.value;
    const acceptedArea = parseAcceptedArea(anchor.acceptedArea);
    if (!venueId || !source || cityId === undefined || startsAt === undefined || acceptedArea === undefined || !expiresAt) return null;
    acceptedAnchor = { venueId, source, cityId, acceptedArea, startsAt, expiresAt };
  }
  return {
    title,
    creatorName,
    startTime,
    conciergeQuery,
    stops: stops as StoredPlanDraft["stops"],
    ...options,
    ...(acceptedAnchor ? { acceptedAnchor } : {}),
  };
}

function withoutExpiredAcceptedAnchor(draft: StoredPlanDraft, now: number): StoredPlanDraft {
  if (!draft.acceptedAnchor || now < Date.parse(draft.acceptedAnchor.expiresAt)) return draft;
  const unanchored = { ...draft };
  delete unanchored.acceptedAnchor;
  return unanchored;
}

/** Parse the unversioned session draft without inventing storage metadata. */
export function parsePlanDraft(raw: string | null, now = Date.now()): StoredPlanDraft | null {
  if (!raw || !Number.isFinite(now) || byteLength(raw) > PLAN_DRAFT_MAX_RAW_BYTES) return null;
  try {
    const draft = parseStoredPlanDraft(JSON.parse(raw), false, now);
    return draft ? withoutExpiredAcceptedAnchor(draft, now) : null;
  } catch {
    return null;
  }
}

function parsePlanDraftV2(
  raw: string | null,
  now = Date.now(),
): ParsedPlanDraft | null {
  if (!raw || !Number.isFinite(now) || byteLength(raw) > PLAN_DRAFT_MAX_RAW_BYTES) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !hasExactKeys(value, ENVELOPE_KEYS)) return null;
    if (value.storageVersion !== PLAN_DRAFT_STORAGE_VERSION) return null;
    if (!(PLAN_DRAFT_ORIGINS as readonly unknown[]).includes(value.origin)) return null;
    const savedAt = canonicalTimestamp(value.savedAt);
    const expiresAt = canonicalTimestamp(value.expiresAt);
    if (!savedAt || !expiresAt) return null;
    if (savedAt.time > now + PLAN_DRAFT_MAX_FUTURE_SKEW_MS) return null;
    if (expiresAt.time !== savedAt.time + PLAN_DRAFT_TTL_MS || now >= expiresAt.time) return null;
    const parsedDraft = parseStoredPlanDraft(value.draft, true, now);
    const draft = parsedDraft ? withoutExpiredAcceptedAnchor(parsedDraft, now) : null;
    if (!draft || (draft.provisionalSavedAt !== undefined && draft.provisionalSavedAt !== savedAt.value)) return null;
    return {
      storageVersion: PLAN_DRAFT_STORAGE_VERSION,
      savedAt: savedAt.value,
      expiresAt: expiresAt.value,
      origin: value.origin as PlanDraftOrigin,
      draft,
      legacy: false,
    };
  } catch {
    return null;
  }
}

/** Prefer a valid V2 envelope; legacy work keeps only provenance written in its own draft. */
export function parsePlanDraftEnvelope(
  rawV2: string | null,
  rawV1: string | null,
  now = Date.now(),
): ParsedPlanDraft | null {
  const v2 = parsePlanDraftV2(rawV2, now);
  if (v2) return v2;
  const draft = parsePlanDraft(rawV1, now);
  return draft
    ? {
        storageVersion: 1,
        savedAt: null,
        expiresAt: null,
        origin: "manual",
        draft,
        legacy: true,
      }
    : null;
}

export function readPlanDraftEnvelope(
  storage: PlanDraftStorage | null,
  now = Date.now(),
): ParsedPlanDraft | null {
  if (!storage) return null;
  try {
    return parsePlanDraftEnvelope(
      storage.getItem(PLAN_DRAFT_V2_KEY),
      storage.getItem(PLAN_DRAFT_KEY),
      now,
    );
  } catch {
    return null;
  }
}

/** Prepare the exact draft used by both writes and their byte readback. */
export function canonicalPlanDraftForWrite(draft: StoredPlanDraft, now: number): StoredPlanDraft | null {
  const savedAt = new Date(now);
  if (!Number.isFinite(savedAt.getTime())) return null;
  const input = draft.provisionalStop ? { ...draft, provisionalSavedAt: savedAt.toISOString() } : draft;
  const parsed = parseStoredPlanDraft(input, false, now);
  return parsed ? withoutExpiredAcceptedAnchor(parsed, now) : null;
}

/** Explicit writes migrate forward while retaining V1 compatibility for rollback. */
export function writePlanDraftEnvelope(
  draft: StoredPlanDraft,
  origin: PlanDraftOrigin,
  storage: PlanDraftStorage | null,
  now = Date.now(),
  options: { requireV1?: boolean } = {},
): PlanDraftWriteResult {
  const canonical = canonicalPlanDraftForWrite(draft, now);
  const savedAt = new Date(now);
  const expiresAt = new Date(now + PLAN_DRAFT_TTL_MS);
  if (
    !storage
    || !canonical
    || !(PLAN_DRAFT_ORIGINS as readonly unknown[]).includes(origin)
    || !Number.isFinite(savedAt.getTime())
    || !Number.isFinite(expiresAt.getTime())
  ) return { v1: false, v2: false, envelope: null };

  const envelope: PlanDraftEnvelopeV2 = {
    storageVersion: PLAN_DRAFT_STORAGE_VERSION,
    savedAt: savedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    origin,
    draft: canonical,
  };
  const rawV1 = JSON.stringify(canonical);
  const rawV2 = JSON.stringify(envelope);
  if (byteLength(rawV1) > PLAN_DRAFT_MAX_RAW_BYTES || byteLength(rawV2) > PLAN_DRAFT_MAX_RAW_BYTES) {
    return { v1: false, v2: false, envelope: null };
  }

  let v1 = false;
  let v2 = false;
  try {
    storage.setItem(PLAN_DRAFT_KEY, rawV1);
    v1 = !options.requireV1 || storage.getItem(PLAN_DRAFT_KEY) === rawV1;
  } catch {}
  if (options.requireV1 && !v1) return { v1: false, v2: false, envelope: null };
  try {
    storage.setItem(PLAN_DRAFT_V2_KEY, rawV2);
    v2 = true;
  } catch {
    // Storage failures remain non-destructive; existing values stay available.
  }
  return { v1, v2, envelope: v2 ? envelope : null };
}
