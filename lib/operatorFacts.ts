// Operator facts (launch plan 1 Nov 2026, section 7 item 1; launch review G1).
//
// A verified pub operator proposes an event, an offer, a correction or a
// response (lib/operatorProposals.ts). A moderator accepts it, and the accept
// branch of app/api/operator-proposals/route.ts publishes ONE operator fact
// (lib/operatorFactsStore.ts). This module is the pure half: the shape, the
// public projection, the words a reader sees and the reading rules. No IO.
//
// WHAT A FACT IS. The pub's own dated word, labelled "From the pub", in its own
// block. It is never a price, never hours on record, never a ranking signal and
// never paid. Nothing that ranks, colours a pin, bands a price or orders a list
// may read it (docs/SPONSORSHIP_POLICY.md, the never-changes list; fence:
// __tests__/operatorFactsFence.test.ts). It is not a placement, so it never
// wears the "Sponsored" label either.
//
// WHAT SHOWS. Only a published fact: a proposal that is pending or declined has
// none, and a decline after an accept withdraws it. A dated event or offer
// leaves the venue sheet once its night is over, and only an event or offer
// dated for tonight's London service day reaches Tonight. `when` stays the
// operator's own words ("Thursdays, 8pm") and is never parsed into a date.

import type { OperatorProposal, OperatorProposalType } from "@/lib/operatorProposals";
import { londonServiceDayBounds } from "@/lib/whatsOn";

export type OperatorFactKind = OperatorProposalType;

/** The stored fact. It carries the operator's account id, which never leaves the server. */
export type OperatorFact = {
  id: string;
  proposalId: string;
  venueId: string;
  accountId: string;
  kind: OperatorFactKind;
  title: string | null;
  body: string | null;
  /** A correction's detail ("Opening hours"). */
  field: string | null;
  /** The operator's own words for when ("Thursdays, 8pm"). */
  when: string | null;
  /** The one London calendar date an event or offer is on, YYYY-MM-DD. */
  onDate: string | null;
  /** When a moderator's acceptance published it. */
  publishedAt: string;
  /** Set when a later decline took it down. A withdrawn fact is never read. */
  withdrawnAt: string | null;
};

/** What a reader receives: no account id and no proposal id. */
export type PublicOperatorFact = {
  id: string;
  venueId: string;
  kind: OperatorFactKind;
  title: string | null;
  body: string | null;
  field: string | null;
  when: string | null;
  onDate: string | null;
  publishedAt: string;
};

/** A published fact for Tonight, named by the pub it came from. */
export type TonightOperatorFact = PublicOperatorFact & { venueName: string };

/** The block's heading on the venue sheet. */
export const FROM_THE_PUB_LABEL = "From the pub";

/** The block's heading on Tonight. */
export const FROM_THE_PUBS_TONIGHT_LABEL = "From the pubs tonight";

export const OPERATOR_FACT_KIND_LABEL: Record<OperatorFactKind, string> = {
  event: "Event",
  offer: "Offer",
  correction: "Correction",
  response: "Response",
};

/** At most this many facts on one venue sheet, newest first. */
const OPERATOR_FACTS_SHEET_LIMIT = 5;

/** At most this many facts in Tonight's block. */
const OPERATOR_FACTS_TONIGHT_LIMIT = 6;

const NIGHT_KINDS: ReadonlySet<OperatorFactKind> = new Set(["event", "offer"]);

function text(value: string | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

/**
 * The fact an accepted proposal publishes. The id is the caller's, so a store
 * that already holds a fact for this proposal keeps its own.
 */
export function operatorFactFromProposal(
  proposal: Pick<OperatorProposal, "id" | "venueId" | "accountId" | "type" | "payload">,
  input: { id: string; publishedAt: string },
): OperatorFact {
  const night = NIGHT_KINDS.has(proposal.type);
  return {
    id: input.id,
    proposalId: proposal.id,
    venueId: proposal.venueId,
    accountId: proposal.accountId,
    kind: proposal.type,
    title: text(proposal.payload.title),
    body: text(proposal.payload.body),
    field: proposal.type === "correction" ? text(proposal.payload.field) : null,
    when: proposal.type === "event" ? text(proposal.payload.startsAt) : null,
    onDate: night ? text(proposal.payload.onDate) : null,
    publishedAt: input.publishedAt,
    withdrawnAt: null,
  };
}

export function isPublishedOperatorFact(fact: Pick<OperatorFact, "withdrawnAt">): boolean {
  return fact.withdrawnAt === null;
}

/** The public projection. The operator's account id stays on the server. */
export function toPublicOperatorFact(fact: OperatorFact): PublicOperatorFact {
  return {
    id: fact.id,
    venueId: fact.venueId,
    kind: fact.kind,
    title: fact.title,
    body: fact.body,
    field: fact.field,
    when: fact.when,
    onDate: fact.onDate,
    publishedAt: fact.publishedAt,
  };
}

function londonYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/**
 * Tonight's London service day, YYYY-MM-DD: the evening that started at 16:00,
 * which is still yesterday's until 04:00 (lib/nightServiceHours.ts).
 */
export function operatorServiceDay(now: number): string {
  return londonYmd(Date.parse(londonServiceDayBounds(now).start));
}

function byNewest(left: { publishedAt: string }, right: { publishedAt: string }): number {
  return right.publishedAt.localeCompare(left.publishedAt);
}

/**
 * What the venue sheet shows: published facts, a dated event or offer only
 * until its night is over, newest first.
 */
export function venueSheetOperatorFacts<T extends OperatorFact>(
  facts: readonly T[],
  now: number,
  limit: number = OPERATOR_FACTS_SHEET_LIMIT,
): T[] {
  const today = operatorServiceDay(now);
  return facts
    .filter((fact) => isPublishedOperatorFact(fact))
    .filter((fact) => fact.onDate === null || fact.onDate >= today)
    .sort(byNewest)
    .slice(0, Math.max(0, limit));
}

/**
 * What Tonight shows: published events and offers dated for this London
 * service day, newest first. A fact with no date is a standing word, never
 * tonight's.
 */
export function tonightOperatorFacts<T extends Pick<OperatorFact, "kind" | "onDate" | "publishedAt">>(
  facts: readonly T[],
  now: number,
  limit: number = OPERATOR_FACTS_TONIGHT_LIMIT,
): T[] {
  const today = operatorServiceDay(now);
  return facts
    .filter((fact) => NIGHT_KINDS.has(fact.kind) && fact.onDate === today)
    .sort(byNewest)
    .slice(0, Math.max(0, limit));
}

/** "1 Nov 2026": the day the pub's word was published. Null for an unreadable stamp. */
function operatorFactPublishedDay(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ms));
}

/** "Sat 7 Nov": the night a dated event or offer is on. Null for no date. */
export function operatorFactOnDay(onDate: string | null): string | null {
  if (!onDate) return null;
  const [year, month, day] = onDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  // Noon UTC on the stated date is inside that London day at either offset.
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/** The line under a fact that says who said it and when. */
export function operatorFactAddedLine(fact: Pick<PublicOperatorFact, "publishedAt">): string {
  const day = operatorFactPublishedDay(fact.publishedAt);
  return day ? `Added by the pub, ${day}` : "Added by the pub";
}

/** The fact's headline: a correction names its detail, the rest their title. */
export function operatorFactHeadline(
  fact: Pick<PublicOperatorFact, "kind" | "title" | "field">,
): string | null {
  if (fact.kind === "correction") return fact.field;
  return fact.title;
}
