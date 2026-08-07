// Browser-safe public-invite constants + DTO shapes. NO server imports here
// (no @/lib/supabase, no node:crypto) so the "use client" invite form and
// page can share one source of truth with the server store and routes,
// mirroring the split between lib/reactions.ts and lib/reactionsStore.ts.

export const RSVP_STATUSES = ["going", "maybe"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

const RSVP_STATUS_SET = new Set<string>(RSVP_STATUSES);
export function isRsvpStatus(value: unknown): value is RsvpStatus {
  return typeof value === "string" && RSVP_STATUS_SET.has(value);
}

export const GUEST_DISPLAY_NAME_MAX = 60;

/** One guest's public RSVP row, as shown on the invite card guest list. */
export type PlanInviteGuest = { id: string; displayName: string; status: RsvpStatus };

/** The full RSVP tally: counts plus the visible guest list, newest first. */
export type PlanInviteRsvpSummary = {
  counts: { going: number; maybe: number };
  guests: PlanInviteGuest[];
};
