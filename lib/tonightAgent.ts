// Tonight agent: thin orchestrator over grounded plan generate + invite draft.
// Never invents prices or routes. A 422 scarcity answer is the product working.

import { formatPriceDay } from "@/lib/communityPrice";
import {
  createPlanIntakeDraft,
  planIntakeHandoff,
  skipRemainingPlanIntake,
  type PlanIntakeHandoff,
} from "@/lib/planIntake";
import type { PlanPriceEvidence } from "@/lib/planRouteEvidence";
import {
  buildPlanInviteShareText,
  planInviteSpendBandFromListedPrices,
  type PlanInviteShareInput,
} from "@/lib/shareArtifacts";

/**
 * The stop fields this surface reads from a /api/plans/generate 200 body.
 * The route (app/api/plans/generate/route.ts) emits exactly these names;
 * anything else in the row is ignored here.
 */
export type PlanGenerateStop = {
  venueId: string;
  venueName: string;
  estimatedPintPricePence: number | null;
  priceEvidence: PlanPriceEvidence | null;
};

export type TonightAgentStop = {
  venueId: string;
  name: string;
  pricePence: number | null;
  /**
   * Dated source for the figure when the optimizer grounded it; null means the
   * figure is the curated index's price, which carries no per-row date.
   */
  priceEvidence: PlanPriceEvidence | null;
};

export type TonightAgentOk = {
  ok: true;
  title: string;
  stops: TonightAgentStop[];
  inviteDraft: string;
  /** Shown beside the draft: share becomes real after the plan is locked. */
  nextStep: string;
};

export type TonightAgentFailure = {
  ok: false;
  kind: "scarcity" | "error";
  message: string;
  code?: string;
};

export type TonightAgentResult = TonightAgentOk | TonightAgentFailure;

export const TONIGHT_AGENT_NEXT_STEP =
  "Lock the plan, then send this on WhatsApp. The invite link appears after lock.";

const FALLBACK_ERROR_MESSAGE = "PUBMAXX couldn't sort this one.";

export type TonightAgentGenerateBody = {
  query: string;
  intake: PlanIntakeHandoff;
};

/** Use the completed Plan intake seam so free-text needs reach grounding. */
export function buildTonightAgentGenerateBody(query: string): TonightAgentGenerateBody {
  return {
    query: query.trim(),
    intake: planIntakeHandoff(skipRemainingPlanIntake(createPlanIntakeDraft())),
  };
}

/** Invite draft text from honest plan facts only. */
export function tonightInviteDraft(input: PlanInviteShareInput): string {
  return buildPlanInviteShareText(input);
}

/**
 * The 422 codes /api/plans/generate answers when the area honestly cannot
 * meet the ask. Everything else non-OK is an error, not scarcity.
 */
const SCARCITY_CODES = new Set([
  "GROUNDED_CONSTRAINTS_UNSATISFIED",
  "GROUNDED_VENUES_INSUFFICIENT",
  "NIGHT_AREA_REQUIRED",
  "NIGHT_AREA_CITY_MISMATCH",
  "NIGHT_AREA_CONSTRAINT_BLOCKED",
  "NIGHT_PATCH_UNSUPPORTED",
]);

/**
 * The caption printed beside a stop's figure. A pound figure never travels
 * bare: a grounded price names its source and the day it was seen, and a
 * curated-index price says plainly that no publisher is recorded for it.
 * Null only when there is no figure to caption.
 */
export function tonightStopPriceCaption(
  stop: TonightAgentStop,
  now: number = Date.now(),
): string | null {
  if (stop.pricePence === null) return null;
  const source = stop.priceEvidence?.source;
  if (!source) return "no publisher recorded";
  const observedAt = Date.parse(source.observedAt);
  if (!Number.isFinite(observedAt)) return "no publisher recorded";
  return `${source.label} · ${formatPriceDay(observedAt, now)}`;
}

/**
 * Interpret a /api/plans/generate JSON body. Fail closed: unknown shapes and
 * non-OK responses become error/scarcity, never a fabricated three-stop.
 */
export function interpretTonightAgentGenerateBody(
  httpOk: boolean,
  body: unknown,
  options?: { title?: string; startClock?: string | null },
): TonightAgentResult {
  if (!body || typeof body !== "object") {
    return { ok: false, kind: "error", message: FALLBACK_ERROR_MESSAGE };
  }
  const record = body as { error?: unknown; code?: unknown; stops?: unknown };

  if (!httpOk) {
    const code = typeof record.code === "string" ? record.code : undefined;
    const message =
      typeof record.error === "string" && record.error.trim()
        ? record.error
        : FALLBACK_ERROR_MESSAGE;
    return {
      ok: false,
      kind: code && SCARCITY_CODES.has(code) ? "scarcity" : "error",
      message,
      code,
    };
  }

  // A grounded 200 for this surface (no anchor sent) always carries three
  // fully-named stops. Anything else is a shape we do not recognise, and a
  // shape we do not recognise is an error we own, never a scarcity verdict
  // put in the server's mouth.
  const stops = extractStops(record.stops);
  if (stops === null || stops.length < 3) {
    return { ok: false, kind: "error", message: FALLBACK_ERROR_MESSAGE };
  }

  const title = (options?.title?.trim() || "Tonight").slice(0, 80);
  const spendBand = planInviteSpendBandFromListedPrices(
    stops.map((stop) => (stop.pricePence === null ? null : stop.pricePence / 100)),
  );
  return {
    ok: true,
    title,
    stops,
    inviteDraft: tonightInviteDraft({
      title,
      stopCount: stops.length,
      startClock: options?.startClock ?? null,
      spendBand,
    }),
    nextStep: TONIGHT_AGENT_NEXT_STEP,
  };
}

/** Read the route's stop rows; a row missing its identity fails the batch. */
function extractStops(raw: unknown): TonightAgentStop[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TonightAgentStop[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return null;
    const stop = row as Partial<PlanGenerateStop>;
    if (typeof stop.venueId !== "string" || !stop.venueId) return null;
    if (typeof stop.venueName !== "string" || !stop.venueName) return null;
    const pricePence =
      typeof stop.estimatedPintPricePence === "number" &&
      Number.isFinite(stop.estimatedPintPricePence) &&
      stop.estimatedPintPricePence > 0
        ? stop.estimatedPintPricePence
        : null;
    out.push({
      venueId: stop.venueId,
      name: stop.venueName,
      pricePence,
      priceEvidence: parsePriceEvidence(stop.priceEvidence, pricePence),
    });
  }
  return out;
}

/**
 * Keep price evidence only when it is well formed AND vouches for the figure
 * we will print. A malformed or mismatched record demotes the caption to
 * "no publisher recorded" rather than dressing the figure in a source it
 * does not have.
 */
function parsePriceEvidence(
  raw: unknown,
  pricePence: number | null,
): PlanPriceEvidence | null {
  if (!raw || typeof raw !== "object" || pricePence === null) return null;
  const evidence = raw as Partial<PlanPriceEvidence>;
  if (evidence.pence !== pricePence) return null;
  const source = evidence.source;
  if (
    !source ||
    typeof source !== "object" ||
    typeof source.label !== "string" ||
    !source.label.trim() ||
    typeof source.url !== "string" ||
    typeof source.observedAt !== "string"
  ) {
    return null;
  }
  const confidenceState = evidence.confidenceState;
  if (
    confidenceState !== "fresh" &&
    confidenceState !== "aging" &&
    confidenceState !== "stale" &&
    confidenceState !== "unknown"
  ) {
    return null;
  }
  return {
    pence: pricePence,
    source: {
      label: source.label,
      url: source.url,
      observedAt: source.observedAt,
    },
    confidenceState,
  };
}
