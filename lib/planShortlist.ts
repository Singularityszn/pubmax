import { DAY_MS } from "@/lib/dayMs";
import { planScheduledEndMs } from "@/lib/inviteExpiry";
import type { VenueListedPint } from "@/lib/venueListedPint";

export const PLAN_SHORTLIST_MAX = 3;
export const PLAN_SHORTLIST_TTL_MS = 7 * DAY_MS;
const PLAN_SHORTLIST_VOTER_CAP = 200;
export const PLAN_SHORTLIST_MOODS = ["balanced", "quiet", "lively", "garden", "food", "heritage"] as const;

export type ShortlistOption = {
  venueId: string;
  venueName: string;
  lat: number;
  lng: number;
  listedPint: VenueListedPint | null;
  reasons: string[];
};

type ShortlistConfirmation = { venueId: string; startTime: string };

export type PlanShortlist = {
  options: ShortlistOption[];
  expiresAt: string;
  votes: Record<string, string>;
  confirmed: ShortlistConfirmation | null;
};

export type ShortlistView = Omit<PlanShortlist, "votes"> & {
  counts: Record<string, number>;
  myVote: string | null;
};

export type ShortlistMutation =
  | { kind: "vote"; venueId: string; voterHash: string; token: string }
  | { kind: "confirm"; venueId: string; startTime: string; hostId: string };

type ShortlistMutationResult =
  | { status: "saved" | "unchanged"; shortlist: PlanShortlist }
  | { status: "invalid" | "closed" | "expired" | "full" };

export function shortlistView(shortlist: PlanShortlist, voterHash?: string): ShortlistView {
  const counts: Record<string, number> = Object.fromEntries(shortlist.options.map(({ venueId }) => [venueId, 0]));
  for (const venueId of Object.values(shortlist.votes)) counts[venueId] = (counts[venueId] ?? 0) + 1;
  const { expiresAt, options, confirmed } = shortlist;
  return { expiresAt, options, confirmed, counts, myVote: voterHash ? shortlist.votes[voterHash] ?? null : null };
}

export function transitionShortlist(
  shortlist: PlanShortlist,
  mutation: ShortlistMutation,
  now: number,
): ShortlistMutationResult {
  if (Date.parse(shortlist.expiresAt) <= now) return { status: "expired" };
  if (shortlist.confirmed) {
    if (mutation.kind === "confirm" && shortlist.confirmed.venueId === mutation.venueId
        && Date.parse(shortlist.confirmed.startTime) === Date.parse(mutation.startTime)) {
      return { status: "unchanged", shortlist };
    }
    return { status: "closed" };
  }
  if (!shortlist.options.some((option) => option.venueId === mutation.venueId)) return { status: "invalid" };
  if (mutation.kind === "confirm") {
    const end = planScheduledEndMs(mutation.startTime);
    if (end === null || Date.parse(mutation.startTime) <= now) return { status: "invalid" };
    return {
      status: "saved",
      shortlist: {
        ...shortlist,
        confirmed: { venueId: mutation.venueId, startTime: mutation.startTime },
        expiresAt: new Date(end).toISOString(),
      },
    };
  }

  const previous = shortlist.votes[mutation.voterHash];
  if (previous === mutation.venueId) return { status: "unchanged", shortlist };
  if (!previous && Object.keys(shortlist.votes).length >= PLAN_SHORTLIST_VOTER_CAP) return { status: "full" };
  return {
    status: "saved",
    shortlist: { ...shortlist, votes: { ...shortlist.votes, [mutation.voterHash]: mutation.venueId } },
  };
}
