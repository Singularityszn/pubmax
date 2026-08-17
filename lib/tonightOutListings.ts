import {
  OUT_DEGRADED_LINE,
  OUT_READ_FAILED_LINE,
  outListingsHealth,
} from "@/lib/out/outStatus";
import type { OutResponse } from "@/lib/out/types";
import { dedupeRows, filterNotPast, type WhatsOnRow } from "@/lib/whatsOn";
import { checkedLabel } from "@/lib/whatsOnBadges";

export type TonightWhatsOnStatus = "idle" | "ready" | "empty" | "error";
export type TonightListingsStatus = TonightWhatsOnStatus;

export type TonightOutAnswer = {
  body:
    | (Pick<OutResponse, "status" | "events" | "reason"> &
        Partial<
          Pick<OutResponse, "observedAt" | "listingsStatus" | "listingsReason">
        >)
    | null;
  failed: boolean;
  pending: boolean;
};

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

/** One list: What's-On plus Out events, newest observation wins a clash. */
export function mergeTonightListingRows(
  whatsOnRows: WhatsOnRow[],
  outEvents: WhatsOnRow[],
  now: number = Date.now(),
): WhatsOnRow[] {
  return dedupeRows([...whatsOnRows, ...filterNotPast(outEvents, now)]);
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
 * Ready when either lane answered with cards, or What's-On answered with some.
 * Idle while either read is still in flight and nothing is ready to show.
 * Error when a finished read failed or degraded and nothing is ready.
 * Empty only when both reads answered and there is nothing to show.
 *
 * The Out events are past-guarded here for the same reason the merge guards
 * them: /out is a whole-day list, so a finished gig still rides its body. A
 * status read off the unguarded body called the page ready over a list the
 * merge had emptied, which paints no cards and no empty sentence either.
 */
export function tonightListingsStatus(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
  now: number = Date.now(),
): TonightListingsStatus {
  const outEvents = filterNotPast(out.body?.events ?? [], now);
  if (outEvents.length > 0 || whatsOn === "ready") return "ready";
  if (whatsOn === "idle" || out.pending) return "idle";
  if (
    whatsOn === "error" ||
    out.failed ||
    outListingsStatus(out).status === "degraded"
  ) {
    return "error";
  }
  return "empty";
}

export const TONIGHT_WHATS_ON_FAILED_LINE =
  "Couldn't reach tonight's listings just now.";
export const TONIGHT_OUT_NOT_CONFIGURED_LINE = "Live listings not set up yet.";

/** One lane's own account of why it is not carrying its share of the night. */
export type TonightLaneReport = {
  lane: "whats-on" | "out";
  line: string;
  /**
   * Whether asking again from this page could change the answer. A lane nobody
   * switched on is not one a reader can re-ask, so it is told and not offered.
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
    reports.push({ lane: "out", line: OUT_READ_FAILED_LINE, retryable: false });
  }
  const listings = outListingsStatus(out);
  if (listings.status === "degraded") {
    reports.push({
      lane: "out",
      line: listings.reason ?? OUT_DEGRADED_LINE,
      retryable: false,
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
): string | null {
  const reports = tonightLaneReports(whatsOn, out);
  return reports.length > 0 ? reports.map((report) => report.line).join(" · ") : null;
}

/** True when a lane behind the note can be asked again from this page. */
export function tonightNoteOffersRetry(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
): boolean {
  return tonightLaneReports(whatsOn, out).some((report) => report.retryable);
}

export const TONIGHT_WHATS_ON_CREDIT = "via what’s-on";
export const TONIGHT_QUIET_NIGHT_LABEL = "Quiet night";

export type TonightProvenanceCredits = {
  /** The What's-On segment of the coverage line, or null when it carried none. */
  whatsOn: string | null;
  /** Its own line: the Out lane's count, its sources and its own date. */
  out: string | null;
  /** False when What's-On could not be dated. */
  whatsOnDated: boolean;
  /** False when Out could not be dated. */
  outDated: boolean;
  /** False when any displayed lane could not be dated. */
  dated: boolean;
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
  /** The one list on screen, already merged and deduped. */
  merged: WhatsOnRow[];
  /** Everything the Out read returned, merged or not. */
  outEvents: WhatsOnRow[];
  whatsOnChecked: string | null;
  outObservedAt?: Record<string, string> | undefined;
}): TonightProvenanceCredits {
  const lanes = tonightListingLanes(input.merged, input.outEvents);
  // With nothing from Out, the coverage count is What's-On's claim, empty night
  // included: the quiet answer came from that read and is credited to it.
  const creditsWhatsOn = lanes.whatsOnCount > 0 || lanes.outRows.length === 0;
  const whatsOn = creditsWhatsOn
    ? `${whatsOnLaneLabel(lanes.whatsOnCount)}${input.whatsOnChecked ? ` · ${input.whatsOnChecked}` : " · undated"} · ${TONIGHT_WHATS_ON_CREDIT}`
    : null;
  const out = outLaneCredit(lanes.outRows, input.outObservedAt ?? {});
  const whatsOnDated = creditsWhatsOn ? input.whatsOnChecked !== null : true;
  return {
    whatsOn,
    out: out.text,
    whatsOnDated,
    outDated: out.dated,
    dated: whatsOnDated && out.dated,
  };
}

function outLaneCredit(
  rows: WhatsOnRow[],
  observedAt: Record<string, string>,
): { text: string | null; dated: boolean } {
  if (rows.length === 0) return { text: null, dated: true };
  const freshestByLabel = new Map<string, string | null>();
  for (const row of rows) {
    const label = row.source?.label?.trim() ?? "";
    if (!label) continue;
    // The response's per-source map is the lane's own answer; a row's stated
    // observation is the fall-back, because the row itself is the evidence.
    const next = canonicalIso(observedAt[label.toLowerCase()] ?? row.observedAt ?? null);
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
