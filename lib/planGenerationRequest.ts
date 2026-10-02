import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { isDrinkCategory } from "@/lib/drinks";
import {
  isBudget,
  isDaypart,
  isNightAreaSlug,
  isPartyType,
  type NightContext,
} from "@/lib/nightPlanning";
import { NIGHT_PATCHES, type NightPatchId } from "@/lib/nightPatches";
import {
  isPlainRecord,
  parsePlanGenerationIntake,
  type ParsedPlanGenerationIntake,
  type PlanIntakeParseFailure,
} from "@/lib/planGenerationIntake";
import {
  PLANNING_INTENT_SOURCES,
  type PlanningIntentArea,
  type PlanningIntentSource,
} from "@/lib/planningIntent";
import { isPlanIdempotencyKey } from "@/lib/planStore";
import { isPlanStopCount } from "@/lib/planStopCount";
import { cleanSelectedDrinkPriceEvidence, type SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";

export const MAX_PLAN_GENERATION_BODY_BYTES = 16_384;
const MAX_PLAN_GENERATION_QUERY_LENGTH = 500;

const REQUEST_KEYS = ["query", "context", "cityId", "intake", "operationKey", "anchor", "routeVenueIds"] as const;
const ANCHOR_KEYS = ["venueId", "source", "acceptedArea", "startsAt"] as const;
const NIGHT_PATCH_AREA_KEYS = ["kind", "id"] as const;
const BOROUGH_AREA_KEYS = ["kind", "name"] as const;
const ANCHOR_VENUE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const CONTEXT_KEYS = [
  "nightArea",
  "daypart",
  "partyType",
  "groupSize",
  "stopCount",
  "budget",
  "budgetLimitPence",
  "zeroProof",
  "drinkCategory",
  "wetherspoonsPreferred",
  "atmosphere",
  "foodNeeds",
  "accessibility",
  "transportConstraints",
] as const satisfies readonly (keyof NightContext)[];

export type PlanGenerationAnchor = {
  venueId: string;
  source: PlanningIntentSource;
  acceptedArea: PlanningIntentArea;
  startsAt: string | null;
  selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence;
};

type PlanGenerationRequest = {
  query: string;
  context: Partial<NightContext> | null;
  cityId: string | null;
  intake: ParsedPlanGenerationIntake | null;
  hasIntake: boolean;
  operationKey: string | null;
  anchor: PlanGenerationAnchor | null;
  routeVenueIds?: string[];
};

type PlanGenerationRequestFailure = {
  ok: false;
  code: PlanIntakeParseFailure["code"] | "MALFORMED_REQUEST" | "REQUEST_TOO_LARGE";
  message: string;
  status: 400 | 413;
};

export type PlanGenerationRequestResult =
  | { ok: true; value: PlanGenerationRequest }
  | PlanGenerationRequestFailure;

function failure(
  message: string,
  code: PlanGenerationRequestFailure["code"] = "MALFORMED_REQUEST",
  status: 400 | 413 = 400,
): PlanGenerationRequestFailure {
  return { ok: false, code, message, status };
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function parseAnchorArea(value: unknown): PlanningIntentArea | undefined {
  if (value === null) return null;
  if (!isPlainRecord(value)) return undefined;
  if (
    hasExactKeys(value, NIGHT_PATCH_AREA_KEYS)
    && value.kind === "night-patch"
    && typeof value.id === "string"
    && NIGHT_PATCHES.some((patch) => patch.id === value.id)
  ) {
    return { kind: "night-patch", id: value.id as NightPatchId };
  }
  if (
    hasExactKeys(value, BOROUGH_AREA_KEYS)
    && value.kind === "borough"
    && typeof value.name === "string"
    && LONDON_BOROUGHS.includes(value.name)
  ) {
    return { kind: "borough", name: value.name };
  }
  return undefined;
}

function canonicalIsoOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? value : undefined;
}

/** Parse the optional acceptance anchor. `undefined` return rejects the request. */
function parseAnchor(value: unknown): PlanGenerationAnchor | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isPlainRecord(value) || !(hasExactKeys(value, ANCHOR_KEYS)
    || hasExactKeys(value, [...ANCHOR_KEYS, "selectedDrinkPriceEvidence"]))) return undefined;
  const selected = cleanSelectedDrinkPriceEvidence(value.selectedDrinkPriceEvidence);
  if (Object.hasOwn(value, "selectedDrinkPriceEvidence") && !selected) return undefined;
  if (typeof value.venueId !== "string" || !ANCHOR_VENUE_ID_PATTERN.test(value.venueId)) return undefined;
  if (typeof value.source !== "string" || !(PLANNING_INTENT_SOURCES as readonly string[]).includes(value.source)) {
    return undefined;
  }
  const acceptedArea = parseAnchorArea(value.acceptedArea);
  if (acceptedArea === undefined) return undefined;
  const startsAt = canonicalIsoOrNull(value.startsAt);
  if (startsAt === undefined) return undefined;
  return {
    venueId: value.venueId,
    source: value.source as PlanningIntentSource,
    acceptedArea,
    startsAt,
    ...(selected ? { selectedDrinkPriceEvidence: selected } : {}),
  };
}

/** A selected route is an exact public identity list, never a normalized hint. */
function parseRouteVenueIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !isPlanStopCount(value.length)) return undefined;
  if (!value.every((id) => typeof id === "string" && /^[A-Za-z0-9:_-]{1,120}$/.test(id))) return undefined;
  return new Set(value).size === value.length ? [...value] : undefined;
}

function strictList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const cleaned: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const text = item.trim();
    if (!text || text.length > 40) return null;
    cleaned.push(text);
  }
  return new Set(cleaned).size === cleaned.length ? cleaned : null;
}

function isNullableIntegerInRange(value: unknown, min: number, max: number): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max);
}

function parseContext(value: unknown): Partial<NightContext> | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isPlainRecord(value) || !hasOnlyKeys(value, CONTEXT_KEYS)) return undefined;
  const result: Partial<NightContext> = {};
  for (const key of Object.keys(value) as (keyof NightContext)[]) {
    const item = value[key];
    switch (key) {
      case "nightArea":
        if (item !== null && !isNightAreaSlug(item)) return undefined;
        result.nightArea = item as NightContext["nightArea"];
        break;
      case "daypart":
        if (!isDaypart(item)) return undefined;
        result.daypart = item;
        break;
      case "partyType":
        if (!isPartyType(item)) return undefined;
        result.partyType = item;
        break;
      case "groupSize":
        if (!isNullableIntegerInRange(item, 1, 30)) return undefined;
        result.groupSize = item;
        break;
      case "stopCount":
        if (!isPlanStopCount(item)) return undefined;
        result.stopCount = item;
        break;
      case "budget":
        if (!isBudget(item)) return undefined;
        result.budget = item;
        break;
      case "budgetLimitPence":
        if (!isNullableIntegerInRange(item, 500, 50_000)) return undefined;
        result.budgetLimitPence = item;
        break;
      case "zeroProof":
        if (typeof item !== "boolean") return undefined;
        result.zeroProof = item;
        break;
      case "drinkCategory":
        if (item !== null && !isDrinkCategory(item)) return undefined;
        result.drinkCategory = item as NightContext["drinkCategory"];
        break;
      case "wetherspoonsPreferred":
        if (typeof item !== "boolean") return undefined;
        result.wetherspoonsPreferred = item;
        break;
      case "atmosphere":
      case "foodNeeds":
      case "accessibility":
      case "transportConstraints": {
        const list = strictList(item);
        if (!list) return undefined;
        result[key] = list;
        break;
      }
    }
  }
  return result;
}

async function boundedRequestText(request: Request): Promise<string | PlanGenerationRequestFailure> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) return failure("Malformed request body.");
    if (declared > MAX_PLAN_GENERATION_BODY_BYTES) {
      return failure("Request body is too large.", "REQUEST_TOO_LARGE", 413);
    }
  }
  if (!request.body) return failure("Malformed request body.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PLAN_GENERATION_BODY_BYTES) {
        await reader.cancel();
        return failure("Request body is too large.", "REQUEST_TOO_LARGE", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    return failure("Malformed request body.");
  }
  return body;
}

/** Decode and validate the complete public request before any costly work. */
export async function parsePlanGenerationRequest(
  request: Request,
  now = new Date(),
): Promise<PlanGenerationRequestResult> {
  const text = await boundedRequestText(request);
  if (typeof text !== "string") return text;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return failure("Malformed request body.");
  }
  if (!isPlainRecord(raw) || !hasOnlyKeys(raw, REQUEST_KEYS)) return failure("Malformed request body.");

  const queryValue = Object.hasOwn(raw, "query") ? raw.query : "";
  if (typeof queryValue !== "string" || queryValue.length > MAX_PLAN_GENERATION_QUERY_LENGTH) {
    return failure("Plan query is invalid.");
  }
  const context = parseContext(raw.context);
  if (context === undefined) return failure("Night Context is invalid.");
  if (Object.hasOwn(raw, "cityId") && typeof raw.cityId !== "string") return failure("cityId is invalid.");

  let intake: ParsedPlanGenerationIntake | null = null;
  const hasIntake = Object.hasOwn(raw, "intake");
  if (hasIntake) {
    const parsed = parsePlanGenerationIntake(raw.intake, now);
    if (!parsed.ok) return { ...parsed, status: 400 };
    intake = parsed.value;
  }
  const routeVenueIds = Object.hasOwn(raw, "routeVenueIds") ? parseRouteVenueIds(raw.routeVenueIds) : undefined;
  if (Object.hasOwn(raw, "routeVenueIds") && !routeVenueIds) return failure("Selected route is invalid.");
  const anchor = parseAnchor(raw.anchor);
  if (anchor === undefined) return failure("Acceptance anchor is invalid.");
  return {
    ok: true,
    value: {
      query: queryValue.trim(),
      context,
      cityId: typeof raw.cityId === "string" ? raw.cityId : null,
      intake,
      hasIntake,
      // A caller may pin idempotency by supplying its own create operation key.
      // Anything that is not a well-formed key is ignored so the route mints one.
      operationKey: isPlanIdempotencyKey(raw.operationKey) ? raw.operationKey.trim() : null,
      anchor,
      ...(routeVenueIds ? { routeVenueIds } : {}),
    },
  };
}
