import type { Route } from "next";

import type { AppOrExternalLink } from "@/lib/appLink";
import { firstHttp } from "@/lib/httpUrl";
import {
  outCardSource,
  outRowSourceCredit,
  outSourceDisplayLabel,
} from "@/lib/out/attribution";
import {
  OUT_DEGRADED_LINE,
  OUT_READ_FAILED_LINE,
  outListingsHealth,
} from "@/lib/out/outStatus";
import type { OutResponse } from "@/lib/out/types";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import type { MapSelectableVenueIds } from "@/lib/pricedLanding";
import type { TonightGroupedRow } from "@/lib/tonightListGrouping";
import { withoutTonightChainRows } from "@/lib/tonightChainLanes";
import { tonightPrimaryRows } from "@/lib/tonightPrimary";
import {
  WHATS_ON_KINDS,
  coveringObservedAt,
  dedupeRows,
  filterNotPast,
  type WhatsOnKind,
  type WhatsOnKindObservedAt,
  type WhatsOnRow,
} from "@/lib/whatsOn";
import { picksState, type PicksState } from "@/lib/picksState";
import { checkedLabel } from "@/lib/whatsOnBadges";

type TonightSelectableVenueIds = MapSelectableVenueIds | undefined;

export type TonightWhatsOnStatus = "idle" | "ready" | "empty" | "error";
export type TonightListingsStatus = TonightWhatsOnStatus;

const TONIGHT_KIND_LEDE_LABEL: Record<WhatsOnKind, string> = {
  sport: "live sport",
  quiz: "pub quizzes",
  deal: "deals",
  music: "live music",
  event: "events",
};

/** Visible category claim for directly confirmed or listed rows on this answer. */
export function tonightListingLede(
  status: TonightListingsStatus,
  rows: readonly WhatsOnRow[],
  selectable: TonightSelectableVenueIds = undefined,
): string | null {
  if (status !== "ready") return null;
  const available = new Set(
    rows
      .filter(
        (row) => row.confidence === "confirmed" || row.confidence === "listed",
      )
      .map((row) => row.kind),
  );
  const labels = WHATS_ON_KINDS.filter((kind) => available.has(kind)).map(
    (kind) => TONIGHT_KIND_LEDE_LABEL[kind],
  );
  if (labels.length === 0) return null;
  const categories = joinLabels(labels);
  const mapPrompt = rows.some((row) => {
    const venueId = canonicalOutVenueId(row.venueId);
    return venueId !== null && tonightMapHrefAllowed(venueId, selectable);
  })
    ? " Open a listed venue on the map."
    : "";
  return `${categories.charAt(0).toUpperCase()}${categories.slice(1)} from sourced listings.${mapPrompt}`;
}

export type TonightOutAnswer = {
  body:
    | (Pick<OutResponse, "status" | "events" | "reason"> &
        Partial<
          Pick<
            OutResponse,
            "observedAt" | "listingsStatus" | "listingsReason" | "venueMatch"
          >
        >)
    | null;
  failed: boolean;
  pending: boolean;
};

/** Whether a row carries a canonical venue identity; map availability is separate. */
export function tonightRowHasListedPub(
  row: WhatsOnRow,
  selectable: TonightSelectableVenueIds = undefined,
): boolean {
  const venueId = canonicalOutVenueId(row.venueId);
  if (!venueId) return false;
  if (selectable === undefined) return true;
  return tonightAcceptedVenueId(row, selectable) !== null;
}

export function tonightAcceptedVenueId(
  row: WhatsOnRow,
  selectable: TonightSelectableVenueIds,
): string | null {
  const venueId = canonicalOutVenueId(row.venueId);
  if (!venueId || selectable === undefined || selectable === null) return null;
  return selectable.has(venueId) ? venueId : null;
}

/** Past-guarded rows that belong on a pub surface, never a theatre dump. */
export function filterTonightPubSurfaceRows(
  rows: readonly WhatsOnRow[],
  now: number = Date.now(),
  selectable: TonightSelectableVenueIds = undefined,
): WhatsOnRow[] {
  // Map shard availability controls deep links only. The /out venue matcher
  // has already proved the row's venue identity; a lazy map shard must not
  // turn confirmed supply into an empty night.
  void selectable;
  return filterNotPast([...rows], now).filter((row) =>
    tonightRowHasListedPub(row),
  );
}

/**
 * Out is a fallback lane for Tonight, not a second pub inventory. Hold its
 * rows until the What's-On spine has answered. An empty spine means there is
 * no confirmed pub listing to pair with a Ticketmaster theatre row; a failed
 * spine may still show Out rows while naming that failure beside them.
 *
 * Only pub-matched Out rows may land: unmatched Ticketmaster theatre and arena
 * cards are not pub events and never reach the list.
 */
function tonightOutEventsForStatus(
  whatsOn: TonightWhatsOnStatus,
  outEvents: readonly WhatsOnRow[],
  now: number = Date.now(),
  selectable: TonightSelectableVenueIds = undefined,
  pubOnly = true,
): WhatsOnRow[] {
  if (whatsOn !== "ready" && whatsOn !== "error") return [];
  return pubOnly
    ? filterTonightPubSurfaceRows(outEvents, now, selectable)
    : filterNotPast([...outEvents], now);
}

/**
 * Tonight shows LISTINGS and no open plans, so it asks the listings lane's own
 * health. The top-level status also carries the open-plans read, and a plans
 * RPC nobody can reach would otherwise put "Some listings could not be checked."
 * over a complete list and turn a genuinely quiet night into an error box.
 */
function outListingsStatus(out: TonightOutAnswer): {
  status: OutResponse["status"] | null;
  reason: string | undefined;
} {
  if (!out.body) return { status: null, reason: undefined };
  return outListingsHealth(out.body);
}

function outVenueMatchUnavailable(out: TonightOutAnswer): boolean {
  if (!out.body || outListingsHealth(out.body).status !== "ready") return false;
  return out.body.venueMatch === "unavailable";
}

/** One list: What's-On plus eligible Out events, newest observation wins a clash. */
export function mergeTonightListingRows(
  whatsOnRows: readonly WhatsOnRow[],
  outEvents: readonly WhatsOnRow[],
  now: number = Date.now(),
  whatsOnStatus: TonightWhatsOnStatus = whatsOnRows.length > 0 ? "ready" : "empty",
  selectable: TonightSelectableVenueIds = undefined,
  pubOnly = true,
): WhatsOnRow[] {
  const pubWhatsOn =
    whatsOnStatus === "ready"
      ? pubOnly
        ? filterTonightPubSurfaceRows(whatsOnRows, now, selectable)
        : [...whatsOnRows]
      : [];
  return dedupeRows([
    ...pubWhatsOn,
    ...tonightOutEventsForStatus(whatsOnStatus, outEvents, now, selectable, pubOnly),
  ]);
}

export type TonightLedeComposition = {
  /** Every eligible row, including the lanes that may not lead. */
  listingRows: WhatsOnRow[];
  /** The rows the first screen is built from: head sentence and card spine. */
  primaryListingRows: WhatsOnRow[];
  /** Status read off the primary rows, so an all-excluded night reads empty. */
  listingsStatus: TonightListingsStatus;
  /** Eligible Out rows, already narrowed to the ones that may lead. */
  outEvents: WhatsOnRow[];
};

/**
 * What the Tonight first screen leads with.
 *
 * The lede is the head sentence plus the first card, and BOTH are composed
 * from the primary rows alone: a JD Wetherspoon deal and a Ticketmaster
 * kind:event row are never what a reader meets first. So `tonightPrimaryRows`
 * runs BEFORE the merge, the status and the lede sentence, never after, and an
 * answer carrying nothing else is honestly empty rather than led by one of
 * them. The secondary Deals and Music lanes keep the unfiltered list, which is
 * why both come back from one call.
 *
 * EVERY CHAIN IS REFUSED HERE, not just the one that led a build in August.
 * `withoutTonightChainRows` takes the Greene King fixtures too: 259 of them
 * ride the bundled sport file, each one saying in its own detail line that the
 * pub has not confirmed the screening, and a list ordered by supply hands the
 * first card to whoever publishes the most rows. They keep their own labelled
 * block under the lede (`lib/tonightChainLanes.ts`), where the chain's name and
 * the day its page was read sit beside them.
 */
export function tonightLedeComposition(
  rows: readonly WhatsOnRow[],
  outAnswer: TonightOutAnswer,
  whatsOnStatus: TonightWhatsOnStatus,
  now: number = Date.now(),
  selectable: TonightSelectableVenueIds = undefined,
): TonightLedeComposition {
  const outBody = outAnswer.body;
  const eligibleOutEvents = tonightOutEventsForStatus(
    whatsOnStatus,
    outBody?.events ?? [],
    now,
    selectable,
    true,
  );
  const primaryWhatsOnRows = withoutTonightChainRows(tonightPrimaryRows(rows));
  const primaryOutEvents = withoutTonightChainRows(
    tonightPrimaryRows(outBody?.events ?? []),
  );
  const primaryOutAnswer: TonightOutAnswer = outBody
    ? { ...outAnswer, body: { ...outBody, events: primaryOutEvents } }
    : outAnswer;
  return {
    listingRows: mergeTonightListingRows(
      rows,
      outBody?.events ?? [],
      now,
      whatsOnStatus,
      selectable,
      true,
    ),
    primaryListingRows: mergeTonightListingRows(
      primaryWhatsOnRows,
      primaryOutEvents,
      now,
      whatsOnStatus,
      selectable,
      true,
    ),
    listingsStatus: tonightListingsStatus(
      whatsOnStatus,
      primaryOutAnswer,
      now,
      primaryWhatsOnRows,
      selectable,
      true,
    ),
    outEvents: withoutTonightChainRows(tonightPrimaryRows(eligibleOutEvents)),
  };
}

/**
 * How many of the merged rows each lane put there.
 *
 * The merge keeps the winning row OBJECT, so reference identity is what says
 * which read a surviving row came from. A row both lanes carried is counted
 * once, under whichever observation won it.
 */
export function tonightListingLanes(
  merged: WhatsOnRow[],
  outEvents: WhatsOnRow[],
): { whatsOnCount: number; outRows: WhatsOnRow[] } {
  const fromOut = new Set<WhatsOnRow>(outEvents);
  const outRows = merged.filter((row) => fromOut.has(row));
  return { whatsOnCount: merged.length - outRows.length, outRows };
}

/**
 * The day the What's-On rows ON SCREEN were observed, or null.
 *
 * THE STAMP IS THE LIVE READ'S OR THERE IS NO STAMP. Captain 6 Sep 2026: the
 * phone printed "Quiet night · Checked 22 Aug · via what's-on" while
 * `/api/whats-on?window=tonight` answered `kindObservedAt.event` of that same
 * morning and the desktop, at the same minute, read "Checked 6 Sept". The line
 * was dated from `sourceObservedAt`, which is the freshest of the BUNDLED
 * artifacts' own `generatedAt` and the rows', so a night carrying no rows was
 * dated by a snapshot file on disk rather than by anything anybody checked.
 *
 * This asks `kindObservedAt` instead - the per-kind map the live read returns
 * and nothing else writes - and takes the covering rule already stated in
 * CLAUDE.md: one line covering several kinds takes the OLDEST of them and goes
 * undated entirely when it cannot date one.
 *
 * A QUIET NIGHT WAS CHECKED, AND THE CHIP NOW SAYS WHEN. With no What's-On row
 * on screen the first cut answered null, so the phone printed "Quiet night · No
 * date on this yet · via what's-on" over a read that had just served 96
 * Wetherspoon deals and 24 Ticketmaster events and dated every one of them
 * (Grok, 7 September 2026). Nothing about that night was undated: the rows the
 * read returned were refused from the lede, which is a decision of ours and not
 * an absence of evidence.
 *
 * So an EMPTY surface takes the read's own date, under two conditions that
 * keep the 6 September ruling above intact. (1) NOTHING MAY BE ON SCREEN: a
 * page carrying Out rows and no What's-On row still claims no What's-On day,
 * because that lane really did contribute nothing to what a reader is looking
 * at. (2) THE READ MUST BE ABOUT TONIGHT: evidence older than
 * `TONIGHT_QUIET_READ_MAX_AGE_MS` cannot say what is on tonight, which is
 * exactly what "Checked 22 Aug" claimed on 6 September, so it goes undated
 * instead. A read that dated nothing answers null either way, because then
 * nobody looked at all.
 */
export function tonightWhatsOnObservedAt(input: {
  /** The grouped cards on screen, in render order. */
  renderedGroups: TonightGroupedRow[];
  /** Everything the Out read returned, merged or not. */
  outEvents: WhatsOnRow[];
  /** The live read's own per-kind observation map. */
  kindObservedAt: WhatsOnKindObservedAt;
  /** Injectable clock, so the quiet night's own date is testable. */
  now?: number;
}): string | null {
  const rows = input.renderedGroups.map((group) => group.row);
  const { outRows } = tonightListingLanes(rows, input.outEvents);
  const fromOut = new Set<WhatsOnRow>(outRows);
  const kinds = new Set<WhatsOnKind>();
  for (const row of rows) {
    if (fromOut.has(row)) continue;
    kinds.add(row.kind);
  }
  if (kinds.size > 0) return coveringObservedAt(input.kindObservedAt, [...kinds]);
  if (input.renderedGroups.length > 0) return null;
  return tonightQuietReadObservedAt(input.kindObservedAt, input.now ?? Date.now());
}

/**
 * How old a read may be and still say what is on TONIGHT.
 *
 * A day. Past that the answer is about another night, and "Checked 22 Aug" over
 * tonight's quiet sentence is the 6 September defect wearing the live read's
 * clothes.
 */
const TONIGHT_QUIET_READ_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The day an empty surface may claim it was checked, or null. */
function tonightQuietReadObservedAt(
  kindObservedAt: WhatsOnKindObservedAt,
  now: number = Date.now(),
): string | null {
  const observed = coveringObservedAt(
    kindObservedAt,
    WHATS_ON_KINDS.filter((kind) => Boolean(kindObservedAt[kind])),
  );
  if (!observed) return null;
  const ms = Date.parse(observed);
  if (!Number.isFinite(ms)) return null;
  return now - ms <= TONIGHT_QUIET_READ_MAX_AGE_MS ? observed : null;
}

/**
 * Ready when either lane answered with cards, or What's-On answered with some.
 * Idle while either read is still in flight and nothing is ready to show.
 * Error when a finished read failed or degraded and nothing is ready.
 * Empty only when both reads answered and there is nothing to show.
 *
 * The Out events are held until What's-On answers, then past-guarded here for
 * the same reason the merge guards them: /out is a whole-day list, so a
 * finished gig still rides its body. A status read off the unguarded body
 * called the page ready over a list the merge had emptied, which paints no
 * cards and no empty sentence either.
 */
export function tonightListingsStatus(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
  now: number = Date.now(),
  whatsOnRows: readonly WhatsOnRow[] = [],
  selectable: TonightSelectableVenueIds = undefined,
  pubOnly = true,
): TonightListingsStatus {
  const merged = mergeTonightListingRows(
    whatsOnRows,
    out.body?.events ?? [],
    now,
    whatsOn,
    selectable,
    pubOnly,
  );
  if (merged.length > 0) return "ready";
  if (whatsOn === "idle" || out.pending) return "idle";
  if (pubOnly && outVenueMatchUnavailable(out)) return "error";
  if (
    whatsOn === "error" ||
    out.failed ||
    outListingsStatus(out).status === "degraded"
  ) {
    return "error";
  }
  return "empty";
}

/**
 * The What's-On status the PAINT reads while a re-read is in flight.
 *
 * `useWhatsOnTonight.retry()` puts the spine back to `idle`, and an `idle` spine
 * contributes nothing AND holds the Out lane's rows back too, so the merge
 * empties. Pressing Retry therefore replaced a full list with a skeleton, which
 * is the `refreshing` case in lib/picksState.ts wearing the first-load shape.
 * This says the rows already on screen may stay there; the STATE beside them
 * still says a read is running and dates what they came from.
 *
 * `heldRowCount` counts BOTH lanes, and it has to. This page's retry control is
 * only offered when the SPINE reported (`tonightNoteOffersRetry`), and a spine
 * that reported carries no rows of its own, so the list under that button is
 * the Out lane's. Counting the spine alone would leave exactly the case this
 * exists for unfixed.
 *
 * A first load holds nothing, so `idle` passes straight through and the
 * skeleton is still what an arriving reader meets.
 */
/** Rows the surface is holding right now, from BOTH lanes. */
export function tonightHeldRowCount(
  rows: readonly WhatsOnRow[],
  out: TonightOutAnswer,
): number {
  return rows.length + (out.body?.events.length ?? 0);
}

export function tonightPaintStatus(
  whatsOn: TonightWhatsOnStatus,
  heldRowCount: number,
): TonightWhatsOnStatus {
  return whatsOn === "idle" && heldRowCount > 0 ? "ready" : whatsOn;
}

/**
 * Tonight's whole picks state, composed where the other Tonight rules live.
 *
 * `picksState` owns the four words; this owns what THIS page means by each of
 * its inputs, so the component reads one call rather than five branches, and a
 * reader looking for how Tonight decides finds it beside the lane reports it is
 * built from.
 *
 * `unreadable` is deliberately wider than `listingsStatus === "error"`: a lane
 * NOBODY ASKED reports a note while the status stays `empty`, and to a reader
 * that is the same absence as a lane that failed (battle test M07). The note is
 * present for both; `retryable` says which of the two it was.
 */
export function tonightPicksState(input: {
  visibleCount: number;
  whatsOn: TonightWhatsOnStatus;
  out: TonightOutAnswer;
  listingsStatus: TonightListingsStatus;
  note: string | null;
  retryLanes: { whatsOn: boolean; out: boolean };
  checkedAt: string | null;
}): PicksState {
  return picksState({
    visibleCount: input.visibleCount,
    inFlight: input.whatsOn === "idle" || input.out.pending,
    unreadable: input.listingsStatus === "error" || input.note !== null,
    reason: input.note,
    retryable: input.retryLanes.whatsOn || input.retryLanes.out,
    checkedAt: input.checkedAt,
  });
}

export const TONIGHT_WHATS_ON_FAILED_LINE =
  "Couldn't reach tonight's listings just now.";
export const TONIGHT_OUT_NOT_CONFIGURED_LINE = "Live listings not set up yet.";
export const TONIGHT_VENUE_INDEX_FAILED_LINE =
  "Couldn't confirm tonight's venues right now.";

/** One lane's own account of why it is not carrying its share of the night. */
export type TonightLaneReport = {
  lane: "whats-on" | "out";
  line: string;
  /**
   * Whether asking this lane again could change its answer. A lane nobody
   * switched on cannot, so it is told and never re-read.
   */
  retryable: boolean;
};

/**
 * Every lane that could not carry its share, in its own words.
 *
 * A degraded Out lane beside real Ticketmaster rows is the case this exists for:
 * the list is short because we could not look, and a reader who is shown cards
 * with nothing beside them reads that shortfall as a quiet city. A lane nobody
 * ASKED speaks here too, because the quiet-night sentence beneath it would
 * otherwise claim an absence on a read that never ran.
 */
export function tonightLaneReports(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
): TonightLaneReport[] {
  const reports: TonightLaneReport[] = [];
  if (out.failed) {
    reports.push({ lane: "out", line: OUT_READ_FAILED_LINE, retryable: true });
  }
  const listings = outListingsStatus(out);
  if (listings.status === "degraded") {
    reports.push({
      lane: "out",
      line: listings.reason ?? OUT_DEGRADED_LINE,
      retryable: true,
    });
  }
  if (listings.status === "not-configured") {
    reports.push({
      lane: "out",
      line: listings.reason ?? TONIGHT_OUT_NOT_CONFIGURED_LINE,
      retryable: false,
    });
  }
  // The spine is the one lane this page's own control can ask again, so a
  // failure here keeps its way back even while Out's rows hold the list up.
  if (whatsOn === "error") {
    reports.push({
      lane: "whats-on",
      line: TONIGHT_WHATS_ON_FAILED_LINE,
      retryable: true,
    });
  }
  return reports;
}

/** The one line saying a lane could not answer, whether or not cards are showing. */
export function tonightListingsNoteLine(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
  selectable: TonightSelectableVenueIds = undefined,
): string | null {
  // Map shard availability does not change the venue-match answer.
  void selectable;
  if (outVenueMatchUnavailable(out)) {
    return TONIGHT_VENUE_INDEX_FAILED_LINE;
  }
  const reports = tonightLaneReports(whatsOn, out);
  return reports.length > 0 ? reports.map((report) => report.line).join(" · ") : null;
}

/**
 * True when the note names the lane this page offers a control for.
 *
 * The spine is that lane. A short Out answer is told and not offered, because a
 * second Out button is not this surface's job.
 */
export function tonightNoteOffersRetry(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
  selectable: TonightSelectableVenueIds = undefined,
): boolean {
  // Map shard availability does not change which data lane can be retried.
  void selectable;
  if (outVenueMatchUnavailable(out)) return true;
  return tonightLaneReports(whatsOn, out).some(
    (report) => report.lane === "whats-on" && report.retryable,
  );
}

/**
 * Which lanes a retry may actually re-read.
 *
 * Only the lanes that reported. Re-reading a healthy lane drops the answer it
 * is holding, so one press would replace a rendered Ticketmaster card with the
 * skeleton and could end with fewer rows than before it was pressed.
 */
export function tonightRetryLanes(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
): { whatsOn: boolean; out: boolean } {
  const reports = tonightLaneReports(whatsOn, out);
  const retryable = (lane: TonightLaneReport["lane"]) =>
    reports.some((report) => report.lane === lane && report.retryable);
  return {
    whatsOn: retryable("whats-on"),
    out: retryable("out") || outVenueMatchUnavailable(out),
  };
}

export const TONIGHT_QUIET_NIGHT_SENTENCE =
  "The city’s having a quiet one tonight. We only list what’s really on, and nothing’s confirmed yet.";

/**
 * The sentence over an empty night, scoped to what was actually read.
 *
 * A lane nobody asked makes the whole-city claim untrue, so the sentence
 * narrows to the lane that answered and the note beside it names the one that
 * did not.
 * Sourced pub suggestions also prevent an empty event list from describing
 * the whole city as quiet.
 */
export function tonightEmptyLead(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
  pubSuggestionCount = 0,
): string {
  const reports = tonightLaneReports(whatsOn, out);
  if (pubSuggestionCount > 0 && reports.length === 0) {
    return "No confirmed events listed tonight.";
  }
  if (reports.length === 0) return TONIGHT_QUIET_NIGHT_SENTENCE;
  return `Nothing listed ${TONIGHT_WHATS_ON_CREDIT}.`;
}

export const TONIGHT_WHATS_ON_CREDIT = "via what’s-on";
const TONIGHT_QUIET_NIGHT_LABEL = "Quiet night";

export type TonightProvenanceCredits = {
  /** The What's-On segment of the coverage line, or null when it carried none. */
  whatsOn: string | null;
  /** Its own line: the Out lane's count, its sources and its own date. */
  out: string | null;
  /** False when What's-On could not be dated. */
  whatsOnDated: boolean;
  /** False when Out could not be dated. */
  outDated: boolean;
};

/**
 * Who confirmed what, and when, for the two lanes that feed this list.
 *
 * The lanes are dated SEPARATELY on purpose. What's-On and Out are read at
 * different times from different sources, so one shared stamp would date a
 * Ticketmaster row to a bundled artifact nobody asked about it. The Out line
 * covers several sources at once, so it takes the OLDEST of the sources it
 * names and goes undated entirely when it cannot date one of them - the
 * covering rule in CLAUDE.md, applied to sources rather than kinds.
 */
export function tonightProvenanceCredits(input: {
  /** The grouped cards on screen, in render order. */
  renderedGroups: TonightGroupedRow[];
  /** Everything the Out read returned, merged or not. */
  outEvents: WhatsOnRow[];
  whatsOnChecked: string | null;
  outObservedAt?: Record<string, string> | undefined;
  pubSuggestionCount?: number;
}): TonightProvenanceCredits {
  const lanes = tonightListingLanes(
    input.renderedGroups.map((group) => group.row),
    input.outEvents,
  );
  // With nothing from Out, the coverage count is What's-On's claim, empty night
  // included: the quiet answer came from that read and is credited to it.
  const creditsWhatsOn = lanes.whatsOnCount > 0 || lanes.outRows.length === 0;
  const whatsOnLabel = lanes.whatsOnCount === 0 && (input.pubSuggestionCount ?? 0) > 0
    ? "No events listed"
    : whatsOnLaneLabel(lanes.whatsOnCount);
  const whatsOn = creditsWhatsOn
    ? `${whatsOnLabel}${input.whatsOnChecked ? ` · ${input.whatsOnChecked}` : " · undated"} · ${TONIGHT_WHATS_ON_CREDIT}`
    : null;
  const out = outLaneCredit(lanes.outRows, input.outObservedAt ?? {});
  const whatsOnDated = creditsWhatsOn ? input.whatsOnChecked !== null : true;
  return {
    whatsOn,
    out: out.text,
    whatsOnDated,
    outDated: out.dated,
  };
}

function outLaneCredit(
  rows: WhatsOnRow[],
  observedAt: Record<string, string>,
): { text: string | null; dated: boolean } {
  if (rows.length === 0) return { text: null, dated: true };
  const freshestByLabel = new Map<string, string | null>();
  for (const row of rows) {
    const raw = row.source?.label?.trim() ?? "";
    if (!raw) continue;
    // Spelled the one way every Out surface spells a publisher, so the credit
    // beside a card and the credit over the list cannot read differently. The
    // per-source map is keyed by the label the lane WROTE, so the lookup keeps
    // the raw one.
    const label = outSourceDisplayLabel(raw);
    // The response's per-source map is the lane's own answer; a row's stated
    // observation is the fall-back, because the row itself is the evidence.
    const next = canonicalIso(observedAt[raw.toLowerCase()] ?? row.observedAt ?? null);
    const held = freshestByLabel.get(label);
    if (held === undefined) {
      freshestByLabel.set(label, next);
      continue;
    }
    if (next && (!held || Date.parse(next) > Date.parse(held))) {
      freshestByLabel.set(label, next);
    }
  }
  const labels = [...freshestByLabel.keys()];
  const unlabelled = labels.length === 0;
  let oldest: string | null = null;
  let everyLabelDated = !unlabelled;
  for (const observed of freshestByLabel.values()) {
    if (!observed) {
      everyLabelDated = false;
      continue;
    }
    if (!oldest || Date.parse(observed) < Date.parse(oldest)) oldest = observed;
  }
  const dated = everyLabelDated && oldest !== null;
  const noun = rows.length === 1 ? "listing" : "listings";
  const via = unlabelled ? "" : ` via ${joinLabels(labels)}`;
  const stamp = dated ? ` · ${checkedLabel(oldest)}` : "";
  return { text: `${rows.length} ${noun}${via}${stamp}`, dated };
}

export type TonightRowLinks = {
  /** The whole card's link, or null when the row carries neither. */
  primary: AppOrExternalLink | null;
  /** The map, when the card link went to the publisher instead. */
  mapHref: Route | null;
  /** How this row's publisher is spelled, wherever the row names it. */
  sourceLabel: string;
};

/**
 * Where one Tonight row leads, and what its publisher is called.
 *
 * A listing credited to a PUBLISHER (Ticketmaster, Skiddle, Common) links to
 * that publisher's own page for the event: their name and event link are a
 * licence obligation, and dropping the link because we happened to resolve a
 * venue discharges nothing. The map keeps its own way in beside the card, as a
 * sibling rather than an anchor inside an anchor, which the parser un-nests.
 * A venue's own listing is unchanged: the pub it names is the destination.
 *
 * What the credit SAYS and where it GOES come from the one owner the /out card
 * reads, so the two surfaces cannot disagree about a row: a publisher whose
 * link lands on another host is named with that host, and a link that opens a
 * front door rather than the event is no link at all, which drops the row
 * through to the map below exactly as a row carrying no link does.
 */
export function tonightRowLinks(
  row: WhatsOnRow,
  selectable: TonightSelectableVenueIds = undefined,
): TonightRowLinks {
  const rawLabel = row.source?.label ?? "";
  const credit = outRowSourceCredit({ label: rawLabel, url: row.source?.url ?? "" });
  const sourceLabel = credit.label;
  const sourceUrl = credit.href ? firstHttp(credit.href) : null;
  const venueId = canonicalOutVenueId(row.venueId);
  const mapHref: Route | null =
    venueId && tonightMapHrefAllowed(venueId, selectable)
      ? `/map?sel=${encodeURIComponent(venueId)}`
      : null;
  const publisherCredited = outCardSource(rawLabel) !== "venue";
  if (publisherCredited && sourceUrl) {
    return { primary: { href: sourceUrl, external: true }, mapHref, sourceLabel };
  }
  if (mapHref) return { primary: { href: mapHref, external: false }, mapHref: null, sourceLabel };
  if (sourceUrl) {
    return { primary: { href: sourceUrl, external: true }, mapHref: null, sourceLabel };
  }
  return { primary: null, mapHref: null, sourceLabel };
}

// A night this read found nothing on is said in words, not as a bare numeral
// over the quiet-night sentence beneath it.
function whatsOnLaneLabel(count: number): string {
  if (count === 0) return TONIGHT_QUIET_NIGHT_LABEL;
  return `${count} ${count === 1 ? "listing" : "listings"}`;
}

function canonicalIso(value: string | null): string | null {
  if (!value) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function joinLabels(labels: string[]): string {
  if (labels.length === 1) return labels[0] as string;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Map deep links only when the eager index confirms the pub opens. */
function tonightMapHrefAllowed(
  venueId: string,
  selectable: TonightSelectableVenueIds,
): boolean {
  if (selectable === undefined) return true;
  if (selectable === null) return false;
  return selectable.has(venueId);
}
