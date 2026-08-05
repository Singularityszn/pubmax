import type {
  CrawlEnding,
  PlanActionDTO,
  PlanDTO,
  PlannedNightStatus,
  PlanStopDTO,
} from "@/lib/plan";
import type { NightContext } from "@/lib/nightPlanning";

export const SOCIAL_CREW_ROLES = ["owner", "cohost", "member"] as const;
export type SocialCrewRole = (typeof SOCIAL_CREW_ROLES)[number];

export const SOCIAL_CREW_VISIBILITIES = ["private", "friends"] as const;
export type SocialCrewVisibility = (typeof SOCIAL_CREW_VISIBILITIES)[number];

export type SocialCrewPhase = "planning" | "live" | "ended";
export type SocialCrewMembershipState = "active" | "left" | "removed";
export type SocialCrewInvitationState =
  | "pending"
  | "accepted"
  | "declined"
  | "revoked"
  | "expired";
export type SocialCrewJoinRequestState =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired";

export type SocialCrewMemberDTO = {
  memberId: string;
  handle: string;
  role: SocialCrewRole;
  joinedAt: string;
};

export type SocialCrewPlanDTO = {
  plan: PlanDTO;
  stops: PlanStopDTO[];
  context: NightContext | null;
  actions: PlanActionDTO[];
  ending: CrawlEnding | null;
};

export type SocialCrewPreviewDTO = {
  kind: "preview";
  title: string;
  phase: SocialCrewPhase;
  nightArea: string | null;
  startsAt: string;
  joinRequestState: "none" | "pending" | "declined";
};

export type SocialCrewPageDTO = {
  kind: "member";
  crewId: string;
  title: string;
  visibility: SocialCrewVisibility;
  phase: SocialCrewPhase;
  nightArea: string | null;
  startsAt: string;
  authorityRevision: number;
  viewer: { memberId: string; role: SocialCrewRole };
  owner: { memberId: string; handle: string };
  members: SocialCrewMemberDTO[];
  plan: SocialCrewPlanDTO;
};

export type SocialCrewReadDTO = SocialCrewPreviewDTO | SocialCrewPageDTO;

export const SOCIAL_CREW_MUTATION_CODES = [
  "created",
  "invited",
  "accepted",
  "declined",
  "revoked",
  "requested",
  "cancelled",
  "updated",
  "transferred",
  "removed",
  "left",
  "replayed",
] as const;
export type SocialCrewMutationCode = (typeof SOCIAL_CREW_MUTATION_CODES)[number];

export type SocialCrewMutationResult = {
  code: SocialCrewMutationCode;
  replayed: boolean;
  crewId?: string;
  memberId?: string;
  invitationId?: string;
  requestId?: string;
  authorityRevision?: number;
};

export function isSocialCrewRole(value: unknown): value is SocialCrewRole {
  return SOCIAL_CREW_ROLES.includes(value as SocialCrewRole);
}

export function isSocialCrewVisibility(
  value: unknown,
): value is SocialCrewVisibility {
  return SOCIAL_CREW_VISIBILITIES.includes(value as SocialCrewVisibility);
}

export function isSocialCrewMutationCode(
  value: unknown,
): value is SocialCrewMutationCode {
  return SOCIAL_CREW_MUTATION_CODES.includes(value as SocialCrewMutationCode);
}

export function socialCrewPhase(status: PlannedNightStatus | undefined): SocialCrewPhase {
  if (status === "active" || status === "ending") return "live";
  if (status === "completed" || status === "abandoned") return "ended";
  return "planning";
}
