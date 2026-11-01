// Operator proposals (Wayfinder 3.5) — the PURE seam: types, allowlists, and the
// untrusted-payload validator. No IO, and DELIBERATELY no import of any venue
// fact module (factClaims, the pint-drop / visit-report / ratings stores, the
// ledger). That absence is load-bearing and asserted by a fence test
// (__tests__/operatorProposalFence.test.ts): a proposal is INERT with respect to
// trusted data. The ONLY path from a proposal to a served fact runs through the
// admin acceptance seam — a moderator accepts it, then the factClaims bridge
// (authority `operator`, rank 0) turns the accepted payload into additive,
// attributed evidence that can never silently overwrite the observed corpus.
// Nothing in THIS file may reach for or even name that bridge (fence test).
//
// A proposal is filed by a VERIFIED operator (lib/venueOperators.ts) and starts
// `pending`. It is attributed (accountId) and structured (a typed payload). An
// admin accepts or declines it; acceptance is what materialises a claim.
//
// The impure dual-backend store lives in lib/operatorProposalsStore.ts.

import { cleanText, readString } from "@/lib/textClean";

export type OperatorProposalType = "correction" | "event" | "offer" | "response";

export const OPERATOR_PROPOSAL_TYPES: readonly OperatorProposalType[] = [
  "correction",
  "event",
  "offer",
  "response",
];

export type OperatorProposalStatus = "pending" | "accepted" | "declined";

const OPERATOR_PROPOSAL_STATUSES: readonly OperatorProposalStatus[] = [
  "pending",
  "accepted",
  "declined",
];

const MAX_PROPOSAL_TITLE = 120;
const MAX_PROPOSAL_BODY = 500;
const MAX_PROPOSAL_FIELD = 60;
const MAX_PROPOSAL_WHEN = 60;
const MAX_PROPOSAL_VENUE_ID = 120;

// One structured payload shape covers all four types; per-type validation below
// enforces which fields are REQUIRED. Kept flat + optional so the store persists
// it as a single jsonb column without a per-type table.
//   correction: field (what) + body (the corrected value)
//   event:      title + startsAt (+ optional body)
//   offer:      title + body (the details)
//   response:   body (the operator's reply; optional title as a subject)
// An event or an offer may also carry `onDate`, the one London calendar date
// it is on (YYYY-MM-DD). It is the only structured date a proposal holds, and
// it is what lets Tonight show a published event on its night. `startsAt` stays
// the operator's own words ("Thursdays, 8pm") and is never parsed into a date.
export type OperatorProposalPayload = {
  title?: string;
  body?: string;
  field?: string;
  startsAt?: string;
  onDate?: string;
};

export type OperatorProposal = {
  id: string;
  venueId: string;
  accountId: string;
  type: OperatorProposalType;
  payload: OperatorProposalPayload;
  status: OperatorProposalStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewerNote?: string;
};

export type OperatorProposalFields = {
  venueId: string;
  accountId: string;
  type: OperatorProposalType;
  payload: OperatorProposalPayload;
};

export type OperatorProposalDTO = {
  id: string;
  venueId: string;
  type: OperatorProposalType;
  payload: OperatorProposalPayload;
  status: OperatorProposalStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewerNote: string | null;
};

export function toOperatorProposalDTO(p: OperatorProposal): OperatorProposalDTO {
  return {
    id: p.id,
    venueId: p.venueId,
    type: p.type,
    payload: p.payload,
    status: p.status,
    createdAt: p.createdAt,
    reviewedAt: p.reviewedAt ?? null,
    reviewerNote: p.reviewerNote ?? null,
  };
}

function isOperatorProposalType(v: unknown): v is OperatorProposalType {
  return typeof v === "string" && (OPERATOR_PROPOSAL_TYPES as readonly string[]).includes(v);
}

export function isOperatorProposalStatus(v: unknown): v is OperatorProposalStatus {
  return typeof v === "string" && (OPERATOR_PROPOSAL_STATUSES as readonly string[]).includes(v);
}

type RawPayload = {
  title?: unknown;
  body?: unknown;
  field?: unknown;
  startsAt?: unknown;
  onDate?: unknown;
};

/** The two kinds that can be on one night. */
function takesOnDate(type: OperatorProposalType): boolean {
  return type === "event" || type === "offer";
}

/**
 * A real calendar date written YYYY-MM-DD, or null. A shape that names no day
 * (2026-02-30) is refused rather than rolled into March.
 */
function operatorCalendarDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
    ? date
    : null;
}

/** Clean the optional payload strings; empties collapse to absent. */
function cleanPayload(raw: RawPayload, type: OperatorProposalType): OperatorProposalPayload {
  const title = cleanText(raw.title, MAX_PROPOSAL_TITLE);
  const body = cleanText(raw.body, MAX_PROPOSAL_BODY);
  const field = cleanText(raw.field, MAX_PROPOSAL_FIELD);
  const startsAt = cleanText(raw.startsAt, MAX_PROPOSAL_WHEN);
  const onDate = takesOnDate(type) ? operatorCalendarDate(raw.onDate) : null;
  const payload: OperatorProposalPayload = {};
  if (title) payload.title = title;
  if (body) payload.body = body;
  if (field) payload.field = field;
  if (startsAt) payload.startsAt = startsAt;
  if (onDate) payload.onDate = onDate;
  return payload;
}

/** Which fields each type must carry to be a meaningful proposal. */
function payloadComplete(type: OperatorProposalType, p: OperatorProposalPayload): boolean {
  switch (type) {
    case "correction":
      return Boolean(p.field && p.body);
    case "event":
      return Boolean(p.title && p.startsAt);
    case "offer":
      return Boolean(p.title && p.body);
    case "response":
      return Boolean(p.body);
  }
}

const INCOMPLETE_MESSAGE: Record<OperatorProposalType, string> = {
  correction: "A correction needs the field and the corrected value.",
  event: "An event needs a title and when it starts.",
  offer: "An offer needs a title and the details.",
  response: "A response needs a message.",
};

export type OperatorProposalValidation =
  | { ok: true; fields: OperatorProposalFields }
  | { ok: false; error: string };

/**
 * Validate an untrusted proposal body against a server-verified accountId. The
 * caller (route) has ALREADY confirmed this account is a VERIFIED operator of the
 * venue before calling — this only shapes the payload. venueId + type required;
 * the payload must carry the type's required fields after cleaning.
 */
export function validateOperatorProposal(
  raw: { venueId?: unknown; type?: unknown; payload?: unknown },
  accountId: string,
): OperatorProposalValidation {
  const account = typeof accountId === "string" ? accountId.trim() : "";
  if (!account) return { ok: false, error: "Sign in to propose an update." };

  const venueId = readString(raw.venueId);
  if (!venueId) return { ok: false, error: "Choose a venue." };
  if (venueId.length > MAX_PROPOSAL_VENUE_ID) {
    return { ok: false, error: "That venue reference is too long." };
  }

  if (!isOperatorProposalType(raw.type)) {
    return { ok: false, error: "Choose a correction, event, offer, or response." };
  }
  const type = raw.type;

  const rawPayload =
    raw.payload && typeof raw.payload === "object" ? (raw.payload as RawPayload) : {};
  const payload = cleanPayload(rawPayload, type);
  if (!payloadComplete(type, payload)) {
    return { ok: false, error: INCOMPLETE_MESSAGE[type] };
  }
  // A date that was sent and is not a real day is refused, never dropped: the
  // operator meant a night, and a proposal without it would read as standing.
  const sentDate = typeof rawPayload.onDate === "string" ? rawPayload.onDate.trim() : "";
  if (takesOnDate(type) && sentDate && !payload.onDate) {
    return { ok: false, error: "Pick a real date, or leave the date empty." };
  }

  return {
    ok: true,
    fields: { venueId: venueId.slice(0, MAX_PROPOSAL_VENUE_ID), accountId: account, type, payload },
  };
}

/**
 * The value a served fact should carry when an accepted proposal is folded into
 * fact resolution. A pure string pick with no fact import: the admin acceptance
 * route reads it and hands it to the factClaims bridge (this module deliberately
 * never names or imports that bridge — see the fence test). A correction serves
 * its corrected value; other types serve their headline.
 */
export function proposalServedValue(p: Pick<OperatorProposal, "type" | "payload">): string {
  if (p.type === "correction") return p.payload.body ?? "";
  return p.payload.title ?? p.payload.body ?? "";
}
