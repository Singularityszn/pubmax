// The "which did you prefer?" flow as one machine (docs/rules/state-machines.md).
// The comparison maths stays in lib/socialPubRankings.ts: the component plans
// each band or answer there and hands the plan in, so this leaf imports types
// only. Every request is an attempt, and its answer carries that attempt and
// the account it was asked for. A late or foreign answer changes nothing.

import type { SocialPubBand, SocialPubComparison, SocialPubRankingEntry } from "@/lib/socialPubRankings";

export type ComparisonVenue = { id: string; name: string; borough?: string };
export type ComparisonNeighbours = { aboveVenueId: string | null; belowVenueId: string | null };

/** Where a band or an answer leaves the comparison: the next pub to ask about, or the slot to save. */
export type ComparisonPlan = {
  band: SocialPubBand;
  session: SocialPubComparison;
  opponent: string | null;
  neighbours: ComparisonNeighbours;
};

/** A save only a fresh list can settle: its answer was lost, or the list moved. */
export type ComparisonUnsettled =
  | { kind: "lost"; band: SocialPubBand; neighbours: ComparisonNeighbours }
  | { kind: "stale"; band: SocialPubBand };

export type ComparisonView =
  | { step: "pick"; notice: string | null }
  | { step: "band"; venue: ComparisonVenue; notice: string | null }
  | { step: "compare"; venue: ComparisonVenue; plan: ComparisonPlan; asked: number; notice: string | null }
  | { step: "saving"; venue: ComparisonVenue; band: SocialPubBand; neighbours: ComparisonNeighbours; attempt: number }
  | { step: "checking"; venue: ComparisonVenue; unsettled: ComparisonUnsettled; attempt: number }
  | { step: "unconfirmed"; venue: ComparisonVenue; unsettled: ComparisonUnsettled }
  | { step: "done"; venue: ComparisonVenue; placed: SocialPubRankingEntry | null }
  | { step: "closed"; reason: "dismissed" | "refused" };

export type ComparisonFlow = {
  /** The account revision the flow was opened for. */
  account: number;
  /** The list the questions are asked against. */
  list: SocialPubRankingEntry[];
  /** A save was sent and the server has not acknowledged it. */
  uncertain: boolean;
  /** `list` came from a read the caller has not been given. */
  unpublished: boolean;
  /** The last attempt minted. */
  attempt: number;
  view: ComparisonView;
};

/** What a save answer that carried no confirmed list says. */
export type ComparisonSaveAnswer =
  | { kind: "saved"; entries: SocialPubRankingEntry[] }
  | { kind: "rejected"; message: string }
  | { kind: "refused" }
  | { kind: "stale" }
  | { kind: "unknown" };

/**
 * A fresh list read after an unsettled save. The component measures it
 * against the open save: `landed` for a lost answer, `restart` for a stale list.
 */
export type ComparisonListRead =
  | { kind: "refused" }
  | { kind: "unavailable" }
  | { kind: "entries"; entries: SocialPubRankingEntry[]; landed: boolean; restart: ComparisonPlan | null };

export type ComparisonEvent =
  | { type: "pick"; venue: ComparisonVenue }
  | { type: "band_chosen"; plan: ComparisonPlan }
  | { type: "answered"; plan: ComparisonPlan }
  | { type: "save_answered"; attempt: number; account: number; answer: ComparisonSaveAnswer }
  | { type: "list_read"; attempt: number; account: number; read: ComparisonListRead }
  | { type: "check_again" }
  | { type: "rank_another" }
  | { type: "dismiss" }
  | { type: "account_changed"; account: number };

export type ComparisonEffect =
  | { type: "save"; attempt: number; venueId: string; band: SocialPubBand; neighbours: ComparisonNeighbours }
  | { type: "check"; attempt: number }
  | { type: "publish"; entries: SocialPubRankingEntry[] }
  /** `refresh`: the caller must read the list again before it trusts its own. */
  | { type: "close"; reason: "dismissed" | "refused"; refresh: boolean };

export type ComparisonStepResult = { flow: ComparisonFlow; effect: ComparisonEffect | null };

const STALE_NOTICE = "Your list changed in another tab. A couple more questions.";
const UNCONFIRMED_NOTICE = "We could not confirm that ranking. Choose how it went again.";

export function startComparison(account: number, entries: SocialPubRankingEntry[], venue?: ComparisonVenue | null): ComparisonFlow {
  return {
    account,
    list: entries,
    uncertain: false,
    unpublished: false,
    attempt: 0,
    view: venue ? { step: "band", venue, notice: null } : { step: "pick", notice: null },
  };
}

const same = (flow: ComparisonFlow): ComparisonStepResult => ({ flow, effect: null });

/** A plan with no pub left to ask about saves; otherwise it asks the next question. */
function follow(flow: ComparisonFlow, venue: ComparisonVenue, plan: ComparisonPlan, asked: number, notice: string | null): ComparisonStepResult {
  if (plan.opponent !== null) {
    return { flow: { ...flow, view: { step: "compare", venue, plan, asked, notice } }, effect: null };
  }
  const attempt = flow.attempt + 1;
  return {
    flow: { ...flow, attempt, uncertain: true, view: { step: "saving", venue, band: plan.band, neighbours: plan.neighbours, attempt } },
    effect: { type: "save", attempt, venueId: venue.id, band: plan.band, neighbours: plan.neighbours },
  };
}

function check(flow: ComparisonFlow, venue: ComparisonVenue, unsettled: ComparisonUnsettled): ComparisonStepResult {
  const attempt = flow.attempt + 1;
  return { flow: { ...flow, attempt, view: { step: "checking", venue, unsettled, attempt } }, effect: { type: "check", attempt } };
}

function acknowledge(flow: ComparisonFlow, venue: ComparisonVenue, entries: SocialPubRankingEntry[]): ComparisonStepResult {
  const placed = entries.find((entry) => entry.venueId === venue.id) ?? null;
  return {
    flow: { ...flow, list: entries, uncertain: false, unpublished: false, view: { step: "done", venue, placed } },
    effect: { type: "publish", entries },
  };
}

function close(flow: ComparisonFlow, reason: "dismissed" | "refused"): ComparisonStepResult {
  if (reason === "refused") {
    return { flow: { ...flow, uncertain: false, view: { step: "closed", reason } }, effect: { type: "close", reason, refresh: false } };
  }
  return {
    flow: { ...flow, view: { step: "closed", reason } },
    effect: { type: "close", reason, refresh: flow.uncertain || flow.unpublished },
  };
}

export function transitionComparison(flow: ComparisonFlow, event: ComparisonEvent): ComparisonStepResult {
  const view = flow.view;
  if (view.step === "closed") return same(flow);
  switch (event.type) {
    case "pick":
      return view.step === "pick" ? { flow: { ...flow, view: { step: "band", venue: event.venue, notice: null } }, effect: null } : same(flow);
    case "band_chosen":
      return view.step === "band" ? follow(flow, view.venue, event.plan, 0, null) : same(flow);
    case "answered":
      return view.step === "compare" ? follow(flow, view.venue, event.plan, view.asked + 1, view.notice) : same(flow);
    case "save_answered": {
      if (view.step !== "saving" || view.attempt !== event.attempt || flow.account !== event.account) return same(flow);
      const answer = event.answer;
      switch (answer.kind) {
        case "saved":
          return acknowledge(flow, view.venue, answer.entries);
        case "rejected":
          // Refused before any write. An earlier unconfirmed save still needs its read on close.
          return { flow: { ...flow, view: { step: "band", venue: view.venue, notice: answer.message } }, effect: null };
        case "refused":
          return close(flow, "refused");
        case "stale":
          return check(flow, view.venue, { kind: "stale", band: view.band });
        case "unknown":
          return check(flow, view.venue, { kind: "lost", band: view.band, neighbours: view.neighbours });
        default: {
          const unreachable: never = answer;
          return unreachable;
        }
      }
    }
    case "list_read": {
      if (view.step !== "checking" || view.attempt !== event.attempt || flow.account !== event.account) return same(flow);
      const read = event.read;
      switch (read.kind) {
        case "refused":
          return close(flow, "refused");
        case "unavailable":
          return { flow: { ...flow, view: { step: "unconfirmed", venue: view.venue, unsettled: view.unsettled } }, effect: null };
        case "entries": {
          if (view.unsettled.kind === "lost" && read.landed) return acknowledge(flow, view.venue, read.entries);
          const fresh = { ...flow, list: read.entries, unpublished: true };
          if (view.unsettled.kind === "stale" && read.restart) return follow(fresh, view.venue, read.restart, 0, STALE_NOTICE);
          return { flow: { ...fresh, view: { step: "band", venue: view.venue, notice: UNCONFIRMED_NOTICE } }, effect: null };
        }
        default: {
          const unreachable: never = read;
          return unreachable;
        }
      }
    }
    case "check_again":
      return view.step === "unconfirmed" ? check(flow, view.venue, view.unsettled) : same(flow);
    case "rank_another":
      return view.step === "done" ? { flow: { ...flow, view: { step: "pick", notice: null } }, effect: null } : same(flow);
    case "dismiss":
      return close(flow, "dismissed");
    case "account_changed":
      return event.account === flow.account ? same(flow) : close(flow, "dismissed");
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
