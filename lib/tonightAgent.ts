// Tonight agent: thin orchestrator over grounded plan generate + invite draft.
// Never invents prices or routes. A 422 scarcity answer is the product working.

import {
  buildPlanInviteShareText,
  type PlanInviteShareInput,
} from "@/lib/shareArtifacts";

export type TonightAgentStop = {
  venueId: string;
  name: string;
  priceGbp: number | null;
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

/** Invite draft text from honest plan facts only. */
export function tonightInviteDraft(input: PlanInviteShareInput): string {
  return buildPlanInviteShareText(input);
}

const SCARCITY_CODES = new Set([
  "GROUNDED_CONSTRAINTS_UNSATISFIED",
  "GROUNDED_VENUES_INSUFFICIENT",
  "NIGHT_AREA_REQUIRED",
  "NIGHT_AREA_CITY_MISMATCH",
  "NIGHT_PATCH_UNSUPPORTED",
]);

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
    return {
      ok: false,
      kind: "error",
      message: "PUBMAXX could not sort this one.",
    };
  }
  const record = body as {
    error?: unknown;
    code?: unknown;
    stops?: unknown;
    route?: unknown;
  };

  if (!httpOk) {
    const code = typeof record.code === "string" ? record.code : undefined;
    const message =
      typeof record.error === "string" && record.error.trim()
        ? record.error
        : "PUBMAXX could not sort this one.";
    return {
      ok: false,
      kind: code && SCARCITY_CODES.has(code) ? "scarcity" : "error",
      message,
      code,
    };
  }

  const stops = extractStops(record);
  if (stops.length < 3) {
    return {
      ok: false,
      kind: "scarcity",
      message: "Not enough listed pubs yet for a three-stop night we can stand behind.",
      code: "GROUNDED_VENUES_INSUFFICIENT",
    };
  }

  const title = (options?.title?.trim() || "Tonight").slice(0, 80);
  return {
    ok: true,
    title,
    stops,
    inviteDraft: tonightInviteDraft({
      title,
      stopCount: stops.length,
      startClock: options?.startClock ?? null,
    }),
    nextStep: TONIGHT_AGENT_NEXT_STEP,
  };
}

function extractStops(body: {
  stops?: unknown;
  route?: unknown;
}): TonightAgentStop[] {
  const rawStops = Array.isArray(body.stops)
    ? body.stops
    : body.route && typeof body.route === "object" && Array.isArray((body.route as { stops?: unknown }).stops)
      ? (body.route as { stops: unknown[] }).stops
      : [];

  const out: TonightAgentStop[] = [];
  for (const row of rawStops) {
    if (!row || typeof row !== "object") continue;
    const stop = row as {
      venueId?: unknown;
      id?: unknown;
      name?: unknown;
      venueName?: unknown;
      priceGbp?: unknown;
      price?: unknown;
      estimatedPintPricePence?: unknown;
    };
    const venueId =
      typeof stop.venueId === "string"
        ? stop.venueId
        : typeof stop.id === "string"
          ? stop.id
          : "";
    const name =
      typeof stop.venueName === "string"
        ? stop.venueName
        : typeof stop.name === "string"
          ? stop.name
          : "";
    if (!venueId || !name) continue;
    let priceGbp: number | null = null;
    if (typeof stop.priceGbp === "number" && Number.isFinite(stop.priceGbp)) {
      priceGbp = stop.priceGbp;
    } else if (typeof stop.price === "number" && Number.isFinite(stop.price)) {
      priceGbp = stop.price;
    } else if (
      typeof stop.estimatedPintPricePence === "number" &&
      Number.isFinite(stop.estimatedPintPricePence) &&
      stop.estimatedPintPricePence > 0
    ) {
      priceGbp = stop.estimatedPintPricePence / 100;
    }
    out.push({ venueId, name, priceGbp });
  }
  return out;
}
