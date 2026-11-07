// What Plan does with a draft crawl the Pub Pal (or Ask the map) proposed.
//
// ADR 0014, decision 3, owns the draft handoff contract:
// docs/adr/0014-night-os-ask-agent.md#decision.
//
// Pure: no storage, no fetch, no clock.

import type { PlanGenerationAnchorInput } from "@/lib/planIntake";
import { MAX_PLAN_STOP_COUNT, MIN_PLAN_STOP_COUNT, normalizePlanStopCount, type PlanStopCount } from "@/lib/planStopCount";

/** A crawl drafted by an ask, as Plan reads it back from the session draft. */
export type PalPlanDraft = {
  query: string;
  stopIds: string[];
  stopNames: string[];
  /** Who drafted it: the Pub Pal's chat, or Ask the map. */
  origin: "pal" | "map";
};

/** How much of a draft a generation attempt is trying to keep. */
export type PalDraftKeep = "all" | "first" | "held" | "none";

export type PalDraftAttempt = {
  keeps: PalDraftKeep;
  anchor: PlanGenerationAnchorInput | null;
  /** Night-context fields the attempt must send (the kept route's length). */
  context: { stopCount?: PlanStopCount };
};

/** Pub Pal proposes crawls with at least three stops. Plan can request fewer. */
const MIN_DRAFT_STOPS = 3;
const VENUE_ID = /^[A-Za-z0-9:_-]{1,128}$/;

function sameAsk(left: string, right: string): boolean {
  const tidy = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return tidy(left) === tidy(right);
}

/** Whether a draft still answers the ask on screen (the drinker may have edited it). */
export function palDraftAnswers(draft: PalPlanDraft, ask: string): boolean {
  return sameAsk(draft.query, ask);
}

/**
 * The draft an ask left in the session, when it still answers `ask`: the ask
 * in the address (the Pal's "Open in Plan") or in the field (Ask the map).
 * Anything malformed, stale or for another ask is no draft at all.
 */
export function palPlanDraftFor(raw: string | null, ask: string | null): PalPlanDraft | null {
  if (!raw || !ask?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { query, stopIds, stopNames, origin } = parsed as Record<string, unknown>;
  if (typeof query !== "string" || !sameAsk(query, ask)) return null;
  if (!Array.isArray(stopIds) || !Array.isArray(stopNames)) return null;
  if (stopIds.length < MIN_DRAFT_STOPS || stopIds.length > MAX_PLAN_STOP_COUNT) return null;
  if (stopNames.length !== stopIds.length) return null;
  if (!stopIds.every((id): id is string => typeof id === "string" && VENUE_ID.test(id))) return null;
  if (new Set(stopIds).size !== stopIds.length) return null;
  if (!stopNames.every((name): name is string => typeof name === "string" && name.trim().length > 0)) return null;
  return {
    query: query.trim(),
    stopIds: [...stopIds],
    stopNames: stopNames.map((name) => name.trim()),
    origin: origin === "map" ? "map" : "pal",
  };
}

/**
 * The generation attempts for one ask, in order. Without a draft it is the one
 * attempt Plan always made. With one: keep every drafted pub, then keep the
 * first and choose the rest, then plan from the ask as before. An accepted
 * first pub takes priority over a conflicting draft.
 */
export function palDraftAttempts(
  draft: PalPlanDraft | null,
  fallbackAnchor: PlanGenerationAnchorInput | null | undefined,
  requestedStopCount: number | null = null,
): PalDraftAttempt[] {
  const plain: PalDraftAttempt = { keeps: draft && fallbackAnchor ? "held" : "none", anchor: fallbackAnchor ?? null, context: {} };
  if (!draft) return [plain];
  const source = draft.origin === "map" ? "map-search" : "pal";
  const first = draft.stopIds[0]!;
  // A draft cannot release an accepted first pub.
  if (fallbackAnchor && fallbackAnchor.venueId !== first) {
    return [plain];
  }
  // An accepted first pub that the draft also starts at keeps its area and time.
  const anchor: PlanGenerationAnchorInput = fallbackAnchor ?? { venueId: first, source, acceptedArea: null, startsAt: null };
  const keepFirst: PalDraftAttempt = { keeps: "first", anchor, context: {} };
  // A request for another number of stops than the draft holds cannot keep
  // every drafted pub: the request's count wins, and the generator refuses
  // a route of the drafted pubs at that count.
  if (requestedStopCount !== null && requestedStopCount !== draft.stopIds.length) return [keepFirst, plain];
  return [
    {
      keeps: "all",
      anchor: { ...anchor, venueIds: [...draft.stopIds] },
      context: { stopCount: normalizePlanStopCount(draft.stopIds.length) },
    },
    keepFirst,
    plain,
  ];
}

/**
 * Whether a keeping attempt's answer ends the attempts. A route that kept the
 * draft, or the generator's refusal (an answer, or a refused request), says
 * something about the drafted pubs. A timeout, a rate limit or a server fault
 * says nothing about them: it is shown as the error it is, and it does not
 * spend further requests from the same limit.
 */
export function palDraftAttemptsStopAt(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

type GeneratedBody = { outcome?: unknown; stops?: unknown } | null;

function stopIdsOf(body: GeneratedBody): string[] {
  if (!body || !Array.isArray(body.stops)) return [];
  return body.stops.flatMap((stop) =>
    stop && typeof stop === "object" && typeof (stop as { venueId?: unknown }).venueId === "string"
      ? [(stop as { venueId: string }).venueId]
      : []);
}

/**
 * Whether an attempt's answer is the route it was trying for. A plain attempt
 * is always taken as the answer, so its own success and errors read as they
 * always did. A keeping attempt counts only as a full route that kept what it
 * promised. An anchor-only fallback or a refusal moves to the next attempt.
 * A requested one-pub meetup can be a complete route. A held attempt is the
 * plain ask with the accepted pub, so its answer stands as it is.
 */
export function palDraftAttemptKept(
  attempt: PalDraftAttempt,
  draft: PalPlanDraft | null,
  ok: boolean,
  body: GeneratedBody,
): boolean {
  if (attempt.keeps === "none" || attempt.keeps === "held" || !draft) return true;
  if (!ok || !body || body.outcome !== "route") return false;
  const ids = stopIdsOf(body);
  if (ids.length < MIN_PLAN_STOP_COUNT) return false;
  if (attempt.keeps === "first") return ids[0] === draft.stopIds[0];
  return ids.length === draft.stopIds.length && draft.stopIds.every((id) => ids.includes(id));
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The status while Plan checks a draft, or `otherwise` when there is none. */
export function palDraftCheckingLine(draft: PalPlanDraft | null, otherwise: string): string {
  if (!draft) return otherwise;
  return draft.origin === "map"
    ? "Checking the draft for your night."
    : "Checking your Pub Pal's draft for your night.";
}

/**
 * The two lines Plan shows once a route lands, with what happened to the draft
 * said first. Without a draft they are the generator's own lines, unchanged.
 */
export function palDraftRouteLines(
  draft: PalPlanDraft | null,
  kept: PalDraftKeep,
  routeNames: readonly string[],
  lines: { conciergeNote: string; routeStatus: string },
): { conciergeNote: string; routeStatus: string } {
  if (!draft) return lines;
  const said = palDraftOutcomeLine(draft, kept, routeNames);
  return {
    // A held pub's own explanation (such as too few pubs nearby) still matters.
    conciergeNote: kept === "held" ? `${said} ${lines.conciergeNote}` : said,
    routeStatus: `${said} ${lines.routeStatus}`,
  };
}

/** The status line that says what Plan did with the draft. */
export function palDraftOutcomeLine(draft: PalPlanDraft, kept: PalDraftKeep, routeNames: readonly string[]): string {
  if (kept === "held") return "Your chosen first pub stays first. The draft does not replace your choice.";
  const whose = draft.origin === "map" ? "the drafted pubs" : "your Pub Pal's pubs";
  const Whose = whose.charAt(0).toUpperCase() + whose.slice(1);
  if (kept === "all") return `Kept ${whose}: ${listed(routeNames)}.`;
  if (kept === "first") {
    return `${Whose} could not all make one route Plan can vouch for, so Plan kept ${draft.stopNames[0]} and chose the rest.`;
  }
  return `${Whose} could not make a route Plan can vouch for tonight, so Plan built one from your ask.`;
}
