import type { PlanState } from "@/lib/plan";
import type { SocialRelationshipResolution } from "@/lib/socialRelationships.server";
import {
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

function activeMembers(raw: RawSocialCrew): RawSocialCrewMember[] {
  return raw.members.filter((member) => member.state === "active");
}

function validJoinRequestState(
  value: SocialCrewJoinRequestState | "none",
): value is "none" | "pending" | "declined" {
  return value === "none" || value === "pending" || value === "declined";
}

export function projectSocialCrewRead(
  raw: RawSocialCrew,
  viewer: SocialCrewProjectionViewer,
): SocialCrewReadDTO | null {
  if (
    !isSocialCrewVisibility(raw.visibility) ||
    !Number.isInteger(raw.authorityRevision) ||
    raw.authorityRevision < 1 ||
    !validJoinRequestState(raw.joinRequestState)
  ) {
    throw new Error("Social Crew authority data is unavailable.");
  }

  const plan = viewer.plan;
  if (plan.plan.id !== raw.planId || !validDate(plan.plan.startTime)) {
    throw new Error("Social Crew Plan data is unavailable.");
  }

  const members = activeMembers(raw);
  if (members.some((member) =>
    !isSocialCrewRole(member.role) ||
    !member.memberId ||
    !member.accountId ||
    !member.profileId ||
    !member.planMemberId ||
    !member.handle ||
    !validDate(member.joinedAt)
  )) {
    throw new Error("Social Crew member data is unavailable.");
  }
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
