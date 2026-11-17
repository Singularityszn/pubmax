// The private Night Receipt for the owner of a completed Plan. Pure: it reads
// only the PlanState and the host role that the account-bound server read
// (lib/nightReceipt.server.ts) has already proved, and it adds no fact those
// records cannot hold up.
//
// Left off on purpose:
// - Crew names. A mate's name needs its own consent, so none is copied in.
// - Arrivals. A crew check-in is not proof that anyone attended.
// - What was paid. A Plan holds no purchase record, and a price on record is
//   not a purchase, so spend stays unknown and no total is summed.

import { categoryLabel } from "@/lib/drinks";
import type { CrawlEnding, PlanMemberRole, PlanState } from "@/lib/plan";
import { cleanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";

type NightReceiptPrice = {
  drink: string;
  pence: number;
  source: "community";
  reportedAt: string;
};

type NightReceiptStop = {
  position: number;
  venueName: string;
  price: NightReceiptPrice | null;
};

export type NightReceipt = {
  title: string;
  plannedFor: string | null;
  stops: NightReceiptStop[];
  ending: CrawlEnding | null;
  paid: "not_recorded";
};

export type NightReceiptProjection = { kind: "none" } | { kind: "receipt"; receipt: NightReceipt };

const NONE: NightReceiptProjection = { kind: "none" };
const ENDINGS: readonly CrawlEnding[] = ["food", "get_home", "keep_going"];

function receiptPrice(value: unknown): NightReceiptPrice | null {
  const evidence = cleanSelectedDrinkPriceEvidence(value);
  if (!evidence) return null;
  return {
    drink: categoryLabel(evidence.category),
    pence: evidence.pence,
    source: evidence.source,
    reportedAt: evidence.reportedAt,
  };
}

function isoOrNull(value: string): string | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function receiptStop(value: unknown): value is NightReceiptStop {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stop = value as Record<string, unknown>;
  if (!Number.isSafeInteger(stop.position) || (stop.position as number) < 0
    || typeof stop.venueName !== "string" || !stop.venueName.trim()) return false;
  if (stop.price === null) return true;
  if (!stop.price || typeof stop.price !== "object" || Array.isArray(stop.price)) return false;
  const price = stop.price as Record<string, unknown>;
  return typeof price.drink === "string" && price.drink.trim().length > 0
    && Number.isSafeInteger(price.pence) && (price.pence as number) > 0
    && price.source === "community" && typeof price.reportedAt === "string"
    && isoOrNull(price.reportedAt) === price.reportedAt;
}

export function readNightReceiptPayload(value: unknown): NightReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = (value as { receipt?: unknown }).receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
  const row = receipt as Record<string, unknown>;
  if (typeof row.title !== "string" || !row.title.trim() || row.paid !== "not_recorded"
    || (row.plannedFor !== null && (typeof row.plannedFor !== "string" || isoOrNull(row.plannedFor) !== row.plannedFor))
    || (row.ending !== null && !ENDINGS.includes(row.ending as CrawlEnding))
    || !Array.isArray(row.stops) || !row.stops.every(receiptStop)) return null;
  return {
    title: row.title,
    plannedFor: row.plannedFor,
    stops: row.stops,
    ending: row.ending as CrawlEnding | null,
    paid: "not_recorded",
  };
}

export function projectNightReceipt(input: {
  state: PlanState | null;
  role: PlanMemberRole | null;
}): NightReceiptProjection {
  const { state, role } = input;
  if (!state || role !== "host" || state.plan.status !== "completed") return NONE;
  const stops = state.stops
    .filter((stop) => typeof stop.venueName === "string" && stop.venueName.trim())
    .sort((left, right) => left.position - right.position)
    .map((stop, position) => ({
      position,
      venueName: stop.venueName.trim(),
      price: receiptPrice(stop.selectedDrinkPriceEvidence),
    }));
  return {
    kind: "receipt",
    receipt: {
      title: state.plan.title,
      plannedFor: isoOrNull(state.plan.startTime),
      stops,
      ending: state.ending && ENDINGS.includes(state.ending) ? state.ending : null,
      paid: "not_recorded",
    },
  };
}
