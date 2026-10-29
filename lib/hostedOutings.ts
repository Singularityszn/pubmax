/** Hosted outings use declared choices only. The operator approves every group. */
export type HostedOutingPace = "easy" | "steady";
export type HostedOutingEnrollmentState = "waiting" | "approved" | "confirmed" | "cancelled";
export type HostedOuting = {
  id: string;
  title: string;
  venueId: string;
  venueName: string;
  startsAt: string;
  capacity: number;
  status: "draft" | "open" | "cancelled" | "completed";
  venueConfirmed: boolean;
  moderatorActive: boolean;
  moderatorName: string | null;
  enrollmentEnabled: boolean;
  signupAllowed: boolean;
  confirmationAllowed: boolean;
  revision: number;
};
export type HostedOutingChoice = {
  profileId: string;
  joinedAt: string;
  pace: HostedOutingPace;
  budgetPence: number;
};
export type HostedOutingProposal = {
  profileIds: string[];
  pace: HostedOutingPace | null;
  budgetPence: number | null;
  explanation: string;
};

type EnrollmentRefusal = "VENUE_UNCONFIRMED" | "MODERATOR_REQUIRED" | "ENROLLMENT_DISABLED" | "OUTING_CLOSED";
type EnrollmentGate = Pick<HostedOuting, "venueConfirmed" | "moderatorActive" | "enrollmentEnabled" | "startsAt" | "status">;
export function hostedOutingEnrollment(outing: EnrollmentGate, now = new Date()):
  { allowed: true } | { allowed: false; reason: EnrollmentRefusal } {
  if (!outing.venueConfirmed) return { allowed: false, reason: "VENUE_UNCONFIRMED" };
  if (!outing.moderatorActive) return { allowed: false, reason: "MODERATOR_REQUIRED" };
  if (!outing.enrollmentEnabled) return { allowed: false, reason: "ENROLLMENT_DISABLED" };
  if (outing.status !== "open" || !Number.isFinite(Date.parse(outing.startsAt)) || Date.parse(outing.startsAt) <= now.getTime()) {
    return { allowed: false, reason: "OUTING_CLOSED" };
  }
  return { allowed: true };
}

/** Earlier eligible signups come first. A block in either direction excludes the pair. */
export function proposeHostedOutingGroup(input: {
  candidates: readonly HostedOutingChoice[];
  blockedPairs: readonly (readonly [string, string])[];
  capacity: number;
  reservedProfileIds?: readonly string[];
}): HostedOutingProposal {
  if (!Number.isInteger(input.capacity) || input.capacity < 2 || input.capacity > 12) {
    return { profileIds: [], pace: null, budgetPence: null, explanation: "The group needs between 2 and 12 places." };
  }
  const ordered = [...input.candidates].filter((choice) =>
    ["easy", "steady"].includes(choice.pace) && Number.isInteger(choice.budgetPence)
    && choice.budgetPence >= 0 && choice.budgetPence <= 100_000 && Number.isFinite(Date.parse(choice.joinedAt)),
  ).sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt) || a.profileId.localeCompare(b.profileId));
  const blocked = (first: string, second: string) => input.blockedPairs.some(([a, b]) =>
    (a === first && b === second) || (b === first && a === second));
  const reservedIds = new Set(input.reservedProfileIds ?? []);
  const reserved = ordered.filter((choice) => reservedIds.has(choice.profileId));
  const unavailable = (): HostedOutingProposal => ({
    profileIds: [], pace: null, budgetPence: null, explanation: "There are not two compatible signups yet.",
  });
  if (reserved.length !== reservedIds.size || reserved.length > input.capacity
    || reserved.some((member, i) => reserved.some((other, j) => i !== j
      && (member.pace !== other.pace || blocked(member.profileId, other.profileId))))) return unavailable();
  let selected: HostedOutingChoice[] = [];
  const firstReserved = reserved[0];
  for (const seed of firstReserved ? [firstReserved] : ordered) {
    const group = firstReserved ? [...reserved] : [seed];
    for (const candidate of ordered) {
      if (group.length >= input.capacity) break;
      if (group.some((member) => member.profileId === candidate.profileId)) continue;
      if (candidate.pace !== seed.pace || group.some((member) => blocked(member.profileId, candidate.profileId))) continue;
      group.push(candidate);
    }
    if (group.length >= 2) { selected = group; break; }
  }
  const first = selected[0];
  if (!first || selected.length < 2) return unavailable();
  return {
    profileIds: selected.map((choice) => choice.profileId),
    pace: first.pace,
    budgetPence: Math.min(...selected.map((choice) => choice.budgetPence)),
    explanation: "Approved places stay. Earlier compatible signups come first. Everyone chose the same pace. The lowest declared budget sets the shared ceiling. Blocked pairs are excluded.",
  };
}
