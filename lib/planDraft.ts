export const PLAN_DRAFT_KEY = "pubmaxx:plan-draft:v1";
export const PLAN_DRAFT_V2_KEY = "pubmax:plan-draft:v2";
export const PLAN_DRAFT_STORAGE_VERSION = 2 as const;
export const PLAN_DRAFT_MAX_RAW_BYTES = 20 * 1024;
export const PLAN_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const PLAN_DRAFT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const PLAN_DRAFT_ORIGINS = [
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
};

export type PlanDraftEnvelopeV2 = {
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
const STOP_KEYS = ["key", "venueId", "venueName"] as const;

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

function parseStoredPlanDraft(value: unknown, exactKeys: boolean): StoredPlanDraft | null {
  if (!isRecord(value) || (exactKeys && !hasExactKeys(value, DRAFT_KEYS))) return null;
  const title = boundedText(value.title, 200);
  const creatorName = boundedText(value.creatorName, 100);
  const startTime = boundedText(value.startTime, 40);
  const conciergeQuery = boundedText(value.conciergeQuery, 500);
  if (title === null || creatorName === null || startTime === null || conciergeQuery === null) return null;
  if (!Array.isArray(value.stops) || value.stops.length < 1 || value.stops.length > 12) return null;

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
  return stops.some((stop) => stop === null)
    ? null
    : { title, creatorName, startTime, conciergeQuery, stops: stops as StoredPlanDraft["stops"] };
}

/** Parse the unversioned session draft without inventing storage metadata. */
export function parsePlanDraft(raw: string | null): StoredPlanDraft | null {
  if (!raw || byteLength(raw) > PLAN_DRAFT_MAX_RAW_BYTES) return null;
  try {
    return parseStoredPlanDraft(JSON.parse(raw), false);
  } catch {
    return null;
  }
}

export function parsePlanDraftV2(
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
    const draft = parseStoredPlanDraft(value.draft, true);
    if (!draft) return null;
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

/** Prefer a valid V2 envelope; fall back to populated legacy work without assigning it an age. */
export function parsePlanDraftEnvelope(
  rawV2: string | null,
  rawV1: string | null,
  now = Date.now(),
): ParsedPlanDraft | null {
  const v2 = parsePlanDraftV2(rawV2, now);
  if (v2) return v2;
  const draft = parsePlanDraft(rawV1);
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

/** Explicit writes migrate forward while retaining V1 compatibility for rollback. */
export function writePlanDraftEnvelope(
  draft: StoredPlanDraft,
  origin: PlanDraftOrigin,
  storage: PlanDraftStorage | null,
  now = Date.now(),
): PlanDraftWriteResult {
  const canonical = parseStoredPlanDraft(draft, false);
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
    v1 = true;
  } catch {
    // A blocked legacy write must not prevent an attempted canonical write.
  }
  try {
    storage.setItem(PLAN_DRAFT_V2_KEY, rawV2);
    v2 = true;
  } catch {
    // Storage failures remain non-destructive; existing values stay available.
  }
  return { v1, v2, envelope: v2 ? envelope : null };
}
