import { OUT_DEGRADED_LINE, OUT_READ_FAILED_LINE } from "@/lib/out/outStatus";
import type { OutResponse } from "@/lib/out/types";
import { dedupeRows, type WhatsOnRow } from "@/lib/whatsOn";

export type TonightWhatsOnStatus = "idle" | "ready" | "empty" | "error";
export type TonightListingsStatus = TonightWhatsOnStatus;

export type TonightOutAnswer = {
  body: Pick<OutResponse, "status" | "events" | "reason"> | null;
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

export function tonightListingsErrorLine(
  whatsOn: TonightWhatsOnStatus,
  out: TonightOutAnswer,
): string {
  if (out.failed) return OUT_READ_FAILED_LINE;
  if (out.body?.status === "degraded") return out.body.reason ?? OUT_DEGRADED_LINE;
  if (whatsOn === "error") return TONIGHT_WHATS_ON_FAILED_LINE;
  return TONIGHT_WHATS_ON_FAILED_LINE;
}
