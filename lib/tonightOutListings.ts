import { OUT_DEGRADED_LINE, OUT_READ_FAILED_LINE } from "@/lib/out/outStatus";
import type { OutResponse } from "@/lib/out/types";
import { dedupeRows, type WhatsOnRow } from "@/lib/whatsOn";
import { checkedLabel } from "@/lib/whatsOnBadges";

export type TonightWhatsOnStatus = "idle" | "ready" | "empty" | "error";
export type TonightListingsStatus = TonightWhatsOnStatus;

export type TonightOutAnswer = {
  body:
    | (Pick<OutResponse, "status" | "events" | "reason"> &
        Partial<Pick<OutResponse, "observedAt">>)
    | null;
  failed: boolean;
  pending: boolean;
};

/** One list: What's-On plus Out events, newest observation wins a clash. */
export function mergeTonightListingRows(
  whatsOnRows: WhatsOnRow[],
  outEvents: WhatsOnRow[],
): WhatsOnRow[] {
  return dedupeRows([...whatsOnRows, ...outEvents]);
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
 */
export function tonightListingsStatus(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
): TonightListingsStatus {
  const outEvents = out.body?.events ?? [];
  if (outEvents.length > 0 || whatsOn === "ready") return "ready";
  if (whatsOn === "idle" || out.pending) return "idle";
  if (whatsOn === "error" || out.failed || out.body?.status === "degraded") {
    return "error";
  }
  return "empty";
}

export const TONIGHT_WHATS_ON_FAILED_LINE =
  "Couldn't reach tonight's listings just now.";

/**
 * The one line saying a lane could not answer, whether or not cards are showing.
 *
 * A degraded Out lane beside real Ticketmaster rows is the case this exists for:
 * the list is short because we could not look, and a reader who is shown cards
 * with nothing beside them reads that shortfall as a quiet city.
 */
export function tonightListingsNoteLine(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
): string | null {
  if (out.failed) return OUT_READ_FAILED_LINE;
  if (out.body?.status === "degraded") return out.body.reason ?? OUT_DEGRADED_LINE;
  if (whatsOn === "error") return TONIGHT_WHATS_ON_FAILED_LINE;
  return null;
}

export function tonightListingsErrorLine(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
): string {
  return tonightListingsNoteLine(whatsOn, out) ?? TONIGHT_WHATS_ON_FAILED_LINE;
}

export const TONIGHT_WHATS_ON_CREDIT = "via what’s-on";

export type TonightProvenanceCredits = {
  /** The What's-On segment of the coverage line, or null when it carried none. */
  whatsOn: string | null;
  /** Its own line: the Out lane's count, its sources and its own date. */
  out: string | null;
  /** False when a lane on screen could not be dated. */
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
    ? `${input.whatsOnChecked ? `${input.whatsOnChecked} · ` : ""}${TONIGHT_WHATS_ON_CREDIT}`
    : null;
  const out = outLaneCredit(lanes.outRows, input.outObservedAt ?? {});
  return {
    whatsOn,
    out: out.text,
    dated: (!creditsWhatsOn || Boolean(input.whatsOnChecked)) && out.dated,
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

function canonicalIso(value: string | null): string | null {
  if (!value) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function joinLabels(labels: string[]): string {
  if (labels.length === 1) return labels[0] as string;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
