import type { PlanState } from "@/lib/plan";
import type { SocialRelationshipResolution } from "@/lib/socialRelationships.server";
import {
  isSocialCrewMembershipState,
  isSocialCrewRole,
  isSocialCrewVisibility,
  socialCrewPhase,
  type SocialCrewJoinRequestState,
  type SocialCrewMembershipState,
  type SocialCrewReadDTO,
  type SocialCrewRole,
} from "@/lib/socialCrew";
import type { SocialPostActor } from "@/lib/socialPostStore";

export type RawSocialCrewMember = {
  memberId: string;
  accountId: string;
  profileId: string;
  planMemberId: string;
  handle: string;
  role: SocialCrewRole;
  state: SocialCrewMembershipState;
  joinedAt: string;
};

export type RawSocialCrew = {
  crewId: string;
  planId: string;
  ownerAccountId: string;
  ownerProfileId: string;
  visibility: "private" | "friends";
  authorityRevision: number;
  joinRequestState: "none" | "pending" | "declined";
  members: RawSocialCrewMember[];
};

export type SocialCrewProjectionViewer = {
  actor: SocialPostActor;
  ownerRelationship: SocialRelationshipResolution;
  plan: PlanState;
};

function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function activeMembers(raw: RawSocialCrew): RawSocialCrewMember[] {
  return raw.members.filter((member) => member.state === "active");
}

function validJoinRequestState(
  value: SocialCrewJoinRequestState | "none",
): value is "none" | "pending" | "declined" {
  return value === "none" || value === "pending" || value === "declined";
}

export function validateRawSocialCrew(raw: RawSocialCrew): void {
  if (
    !validUuid(raw.crewId) ||
    !validUuid(raw.planId) ||
    !validUuid(raw.ownerAccountId) ||
    !validUuid(raw.ownerProfileId) ||
    !isSocialCrewVisibility(raw.visibility) ||
    !Number.isInteger(raw.authorityRevision) ||
    raw.authorityRevision < 1 ||
    !validJoinRequestState(raw.joinRequestState) ||
    !Array.isArray(raw.members)
  ) {
    throw new Error("Social Crew authority data is unavailable.");
  }
  if (raw.members.some((member) =>
    !isSocialCrewRole(member.role) ||
    !isSocialCrewMembershipState(member.state) ||
    !validUuid(member.memberId) ||
    !validUuid(member.accountId) ||
    !validUuid(member.profileId) ||
    !validUuid(member.planMemberId) ||
    !member.handle.trim() ||
    !validDate(member.joinedAt)
  )) {
    throw new Error("Social Crew member data is unavailable.");
  }
}

export function projectSocialCrewRead(
  raw: RawSocialCrew,
  viewer: SocialCrewProjectionViewer,
): SocialCrewReadDTO | null {
  validateRawSocialCrew(raw);

  const plan = viewer.plan;
  if (plan.plan.id !== raw.planId || !validDate(plan.plan.startTime)) {
    throw new Error("Social Crew Plan data is unavailable.");
  }

  const members = activeMembers(raw);
  const owner = members.find((member) =>
    member.accountId === raw.ownerAccountId &&
    member.profileId === raw.ownerProfileId &&
    member.role === "owner"
  );
  if (!owner) throw new Error("Social Crew owner data is unavailable.");

  const actorMember = members.find((member) =>
    member.accountId === viewer.actor.accountId &&
    member.profileId === viewer.actor.profileId
  );
  const phase = socialCrewPhase(plan.plan.status);
  const nightArea = plan.context?.nightArea ?? null;

  if (!actorMember) {
    if (raw.visibility !== "friends" || viewer.ownerRelationship !== "mutual") {
      return null;
    }
    return {
      kind: "preview",
      title: plan.plan.title,
      phase,
      nightArea,
      startsAt: plan.plan.startTime,
      joinRequestState: raw.joinRequestState,
    };
  }

  const ownerIsViewer = actorMember.memberId === owner.memberId;
  if (
    (ownerIsViewer && viewer.ownerRelationship !== "self") ||
    (!ownerIsViewer && viewer.ownerRelationship !== "mutual")
  ) {
    return null;
  }

  return {
    kind: "member",
    crewId: raw.crewId,
    title: plan.plan.title,
    visibility: raw.visibility,
    phase,
    nightArea,
    startsAt: plan.plan.startTime,
    authorityRevision: raw.authorityRevision,
    viewer: { memberId: actorMember.memberId, role: actorMember.role },
    owner: { memberId: owner.memberId, handle: owner.handle },
    members: members.map((member) => ({
      memberId: member.memberId,
      handle: member.handle,
      role: member.role,
      joinedAt: member.joinedAt,
    })),
    plan: {
      plan: { ...plan.plan },
      stops: plan.stops.map((stop) => ({ ...stop })),
      context: plan.context ?? null,
      actions: (plan.actions ?? []).map((action) => ({ ...action })),
      ending: plan.ending ?? null,
    },
  };
}
