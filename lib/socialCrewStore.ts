import { createHash } from "node:crypto";

import { hashPlanMemberToken, socialBoundPlanStateResult, type PlanStateLookupResult } from "@/lib/planStore";
import {
  isSocialCrewMutationCode,
  isSocialCrewRole,
  isSocialCrewVisibility,
  type SocialCrewMutationResult,
  type SocialCrewMutationCode,
  type SocialCrewReadDTO,
  type SocialCrewRole,
  type SocialCrewVisibility,
} from "@/lib/socialCrew";
import {
  projectSocialCrewRead,
  type RawSocialCrew,
  type RawSocialCrewMember,
  validateRawSocialCrew,
} from "@/lib/socialCrewProjection.server";
import {
  socialRelationshipBetweenProfiles,
  type SocialRelationshipResolution,
} from "@/lib/socialRelationships.server";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { requireSupabaseAdmin } from "@/lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SocialCrewRpcName =
  | "create_social_crew_atomic"
  | "invite_social_crew_member_atomic"
  | "accept_social_crew_invitation_atomic"
  | "revoke_social_crew_invitation_atomic"
  | "request_social_crew_join_atomic"
  | "decide_social_crew_join_request_atomic"
  | "set_social_crew_role_atomic"
  | "transfer_social_crew_owner_atomic"
  | "remove_social_crew_member_atomic"
  | "leave_social_crew_atomic"
  | "update_social_crew_visibility_atomic";

export type SocialCrewStoreDependencies = {
  rpc(name: SocialCrewRpcName, input: Record<string, unknown>): Promise<unknown>;
  loadCrew(crewId: string, viewerAccountId: string): Promise<RawSocialCrew | null>;
  loadPlan(planId: string, ownerAccountId: string): Promise<PlanStateLookupResult>;
  relationshipBetweenProfiles(
    firstProfileId: string,
    secondProfileId: string,
  ): Promise<SocialRelationshipResolution>;
};

export class SocialCrewStoreError extends Error {
  constructor(
    public readonly code: "INVALID" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE",
    public readonly status: 400 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}

type WriteInput = { idempotencyKey: string };
type CreateInput = WriteInput & {
  planId: string;
  hostCapability: string;
  visibility: SocialCrewVisibility;
};
type InviteInput = WriteInput & { crewId: string; targetProfileId: string };
type InvitationActionInput = WriteInput & {
  invitationId: string;
  action: "accept" | "decline";
};
type InvitationInput = WriteInput & { invitationId: string };
type JoinRequestInput = WriteInput & {
  crewId: string;
  action: "request" | "cancel";
};
type JoinDecisionInput = WriteInput & {
  requestId: string;
  decision: "accept" | "decline";
};
type MemberRoleInput = WriteInput & {
  crewId: string;
  memberId: string;
  role: Exclude<SocialCrewRole, "owner">;
};
type MemberInput = WriteInput & { crewId: string; memberId: string };
type CrewInput = WriteInput & { crewId: string };
type VisibilityInput = WriteInput & {
  crewId: string;
  visibility: SocialCrewVisibility;
  expectedAuthorityRevision: number;
};

export type SocialCrewStore = {
  read(crewId: string, actor: SocialPostActor): Promise<SocialCrewReadDTO>;
  create(actor: SocialPostActor, input: CreateInput): Promise<SocialCrewMutationResult>;
  invite(actor: SocialPostActor, input: InviteInput): Promise<SocialCrewMutationResult>;
  acceptInvitation(actor: SocialPostActor, input: InvitationActionInput): Promise<SocialCrewMutationResult>;
  revokeInvitation(actor: SocialPostActor, input: InvitationInput): Promise<SocialCrewMutationResult>;
  requestJoin(actor: SocialPostActor, input: JoinRequestInput): Promise<SocialCrewMutationResult>;
  decideJoin(actor: SocialPostActor, input: JoinDecisionInput): Promise<SocialCrewMutationResult>;
  setRole(actor: SocialPostActor, input: MemberRoleInput): Promise<SocialCrewMutationResult>;
  transferOwner(actor: SocialPostActor, input: MemberInput): Promise<SocialCrewMutationResult>;
  removeMember(actor: SocialPostActor, input: MemberInput): Promise<SocialCrewMutationResult>;
  leave(actor: SocialPostActor, input: CrewInput): Promise<SocialCrewMutationResult>;
  updateVisibility(actor: SocialPostActor, input: VisibilityInput): Promise<SocialCrewMutationResult>;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function invalid(): never {
  throw new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid.");
}

function notFound(): never {
  throw new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found.");
}

function unavailable(): never {
  throw new SocialCrewStoreError("UNAVAILABLE", 503, "Social Crew is unavailable right now.");
}

function validActor(actor: SocialPostActor): boolean {
  return isUuid(actor.accountId) && isUuid(actor.profileId) && typeof actor.handle === "string" && actor.handle.length > 0;
}

function idempotencyKey(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const clean = value.trim();
  if (clean.length < 16 || clean.length > 128) return invalid();
  return clean;
}

function payloadDigest(operation: string, value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify({ operation, ...value }))
    .digest("hex");
}

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable();
  return value as Record<string, unknown>;
}

function requiredUuid(value: unknown): string {
  return isUuid(value) ? value : unavailable();
}

function requiredRevision(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 1
    ? Number(value)
    : unavailable();
}

type FixedWriteContract = {
  codes: readonly SocialCrewMutationCode[];
  result(
    base: SocialCrewMutationResult,
    value: Record<string, unknown>,
  ): SocialCrewMutationResult;
};

const FIXED_WRITE_CONTRACTS: Partial<Record<SocialCrewRpcName, FixedWriteContract>> = {
  create_social_crew_atomic: {
    codes: ["created", "replayed"],
    result: (base, value) => ({
      ...base,
      crewId: requiredUuid(value.crew_id),
      memberId: requiredUuid(value.member_id),
    }),
  },
  invite_social_crew_member_atomic: {
    codes: ["invited", "replayed"],
    result: (base, value) => ({ ...base, invitationId: requiredUuid(value.invitation_id) }),
  },
  revoke_social_crew_invitation_atomic: {
    codes: ["revoked", "replayed"],
    result: (base, value) => ({ ...base, invitationId: requiredUuid(value.invitation_id) }),
  },
  set_social_crew_role_atomic: {
    codes: ["updated", "replayed"],
    result: (base, value) => ({ ...base, memberId: requiredUuid(value.member_id) }),
  },
  transfer_social_crew_owner_atomic: {
    codes: ["transferred", "replayed"],
    result: (base, value) => ({ ...base, memberId: requiredUuid(value.member_id) }),
  },
  remove_social_crew_member_atomic: {
    codes: ["removed", "replayed"],
    result: (base, value) => ({ ...base, memberId: requiredUuid(value.member_id) }),
  },
  leave_social_crew_atomic: {
    codes: ["left", "replayed"],
    result: (base, value) => ({ ...base, memberId: requiredUuid(value.member_id) }),
  },
  update_social_crew_visibility_atomic: {
    codes: ["updated", "replayed"],
    result: (base, value) => ({
      ...base,
      authorityRevision: requiredRevision(value.authority_revision),
    }),
  },
};

function parseSuccessfulWrite(
  name: SocialCrewRpcName,
  input: Record<string, unknown>,
  value: Record<string, unknown>,
  code: string,
): SocialCrewMutationResult {
  if (!isSocialCrewMutationCode(code)) return unavailable();
  const result: SocialCrewMutationResult = { code, replayed: code === "replayed" };
  const fixedContract = FIXED_WRITE_CONTRACTS[name];
  if (fixedContract) {
    if (!fixedContract.codes.includes(code)) return unavailable();
    return fixedContract.result(result, value);
  }
  switch (name) {
    case "accept_social_crew_invitation_atomic": {
      const expected = input.p_action === "accepted" ? "accepted" : "declined";
      if (code !== expected && code !== "replayed") return unavailable();
      return expected === "accepted"
        ? { ...result, memberId: requiredUuid(value.member_id) }
        : result;
    }
    case "request_social_crew_join_atomic": {
      const expected = input.p_action === "pending" ? "requested" : "cancelled";
      if (code !== expected && code !== "replayed") return unavailable();
      return { ...result, requestId: requiredUuid(value.request_id) };
    }
    case "decide_social_crew_join_request_atomic": {
      const expected = input.p_decision === "accepted" ? "accepted" : "declined";
      if (code !== expected && code !== "replayed") return unavailable();
      return expected === "accepted"
        ? { ...result, memberId: requiredUuid(value.member_id) }
        : result;
    }
    default:
      return unavailable();
  }
}

function parseWriteResponse(
  name: SocialCrewRpcName,
  input: Record<string, unknown>,
  value: unknown,
): SocialCrewMutationResult {
  const wrapped = row(value);
  if ("error" in wrapped || "data" in wrapped) {
    if (wrapped.error) return unavailable();
    return parseWriteResponse(name, input, wrapped.data);
  }
  const code = typeof wrapped.code === "string" ? wrapped.code : "";
  if (wrapped.ok !== true) {
    if (code === "not_found") return notFound();
    if (code === "invalid") return invalid();
    if (
      code === "conflict" ||
      code === "idempotency_conflict" ||
      code === "already_member" ||
      code === "already_pending" ||
      code === "already_decided" ||
      code === "expired" ||
      code === "full" ||
      code === "owner_cannot_leave"
    ) {
      throw new SocialCrewStoreError("CONFLICT", 409, "Social Crew changed before this request.");
    }
    return unavailable();
  }
  return parseSuccessfulWrite(name, input, wrapped, code);
}

function writeArguments(
  actor: SocialPostActor,
  operation: string,
  key: unknown,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!validActor(actor)) return invalid();
  const cleanKey = idempotencyKey(key);
  return {
    p_actor_account_id: actor.accountId,
    ...payload,
    p_idempotency_key: cleanKey,
    p_payload_digest: payloadDigest(operation, payload),
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type JoinRequestPreviewRow = {
  state: unknown;
  expiresAt: unknown;
  createdAt?: unknown;
  decidedAt?: unknown;
};

function previewStateFromLatest(
  latest: JoinRequestPreviewRow | null,
  now = new Date(),
): RawSocialCrew["joinRequestState"] {
  if (!latest) return "none";
  if (latest.state === "declined") return "declined";
  if (
    latest.state === "pending" &&
    typeof latest.expiresAt === "string" &&
    Number.isFinite(Date.parse(latest.expiresAt)) &&
    Date.parse(latest.expiresAt) > now.getTime()
  ) {
    return "pending";
  }
  return "none";
}

function joinRequestDecisionOrder(row: JoinRequestPreviewRow): number {
  if (row.state === "pending" && row.decidedAt == null) return Number.POSITIVE_INFINITY;
  if (typeof row.decidedAt !== "string" || !Number.isFinite(Date.parse(row.decidedAt))) {
    throw new Error("Social Crew Join Request data is unavailable.");
  }
  return Date.parse(row.decidedAt);
}

export function socialCrewJoinRequestPreviewState(
  value: JoinRequestPreviewRow | readonly JoinRequestPreviewRow[] | null,
  now = new Date(),
): RawSocialCrew["joinRequestState"] {
  if (!Array.isArray(value)) {
    return previewStateFromLatest(value as JoinRequestPreviewRow | null, now);
  }
  if (value.length === 0) return "none";
  const rows = [...value];
  for (const item of rows) {
    if (typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))) {
      throw new Error("Social Crew Join Request data is unavailable.");
    }
  }
  rows.sort((first, second) => {
    const created = Date.parse(String(second.createdAt)) - Date.parse(String(first.createdAt));
    return created || joinRequestDecisionOrder(second) - joinRequestDecisionOrder(first);
  });
  const [latest, next] = rows;
  if (!latest) return "none";
  if (
    next &&
    latest.createdAt === next.createdAt &&
    joinRequestDecisionOrder(latest) === joinRequestDecisionOrder(next) &&
    latest.state !== next.state
  ) {
    throw new Error("Social Crew Join Request order is unavailable.");
  }
  return previewStateFromLatest(latest, now);
}

function defaultMemberRows(
  memberRows: Record<string, unknown>[],
  accountRows: Record<string, unknown>[],
  profileRows: Record<string, unknown>[],
): RawSocialCrewMember[] {
  const accounts = new Map(accountRows.map((account) => [text(account.id), text(account.profile_id)]));
  const profiles = new Map(profileRows.map((profile) => [text(profile.id), text(profile.handle)]));
  return memberRows.map((member) => {
    const accountId = text(member.social_account_id);
    const profileId = accounts.get(accountId) ?? "";
    return {
      memberId: text(member.id),
      accountId,
      profileId,
      planMemberId: text(member.plan_member_id),
      handle: profiles.get(profileId) ?? "",
      role: member.role as SocialCrewRole,
      state: member.state as RawSocialCrewMember["state"],
      joinedAt: text(member.joined_at),
    };
  });
}

async function loadCrewFromSupabase(
  crewId: string,
  viewerAccountId: string,
): Promise<RawSocialCrew | null> {
  const admin = requireSupabaseAdmin();
  const { data: crewData, error: crewError } = await admin
    .from("social_crews")
    .select("id,plan_id,owner_account_id,visibility,authority_revision")
    .eq("id", crewId)
    .maybeSingle();
  if (crewError) throw new Error(crewError.message);
  if (!crewData) return null;

  const { data: memberData, error: memberError } = await admin
    .from("social_crew_members")
    .select("id,social_account_id,plan_member_id,role,state,joined_at")
    .eq("crew_id", crewId)
    .order("joined_at")
    .order("id");
  if (memberError) throw new Error(memberError.message);
  const memberRows = (memberData ?? []) as Record<string, unknown>[];
  const accountIds = [...new Set(memberRows.map((member) => text(member.social_account_id)).filter(Boolean))];
  if (accountIds.length === 0) throw new Error("Social Crew has no authority members.");

  const { data: accountData, error: accountError } = await admin
    .from("private_social_accounts")
    .select("id,profile_id")
    .in("id", accountIds);
  if (accountError) throw new Error(accountError.message);
  const accountRows = (accountData ?? []) as Record<string, unknown>[];
  const profileIds = [...new Set(accountRows.map((account) => text(account.profile_id)).filter(Boolean))];
  const { data: profileData, error: profileError } = await admin
    .from("profiles")
    .select("id,handle")
    .in("id", profileIds);
  if (profileError) throw new Error(profileError.message);
  const members = defaultMemberRows(
    memberRows,
    accountRows,
    (profileData ?? []) as Record<string, unknown>[],
  );
  const owner = members.find((member) => member.accountId === crewData.owner_account_id);
  if (!owner) throw new Error("Social Crew owner is unavailable.");

  const { data: requestData, error: requestError } = await admin
    .from("social_crew_join_requests")
    .select("state,expires_at,created_at,decided_at")
    .eq("crew_id", crewId)
    .eq("requester_account_id", viewerAccountId)
    .order("created_at", { ascending: false })
    .order("decided_at", { ascending: false, nullsFirst: true })
    .limit(2);
  if (requestError) throw new Error(requestError.message);
  const joinRequestState = socialCrewJoinRequestPreviewState((requestData ?? []).map((request) => ({
    state: request.state,
    expiresAt: request.expires_at,
    createdAt: request.created_at,
    decidedAt: request.decided_at,
  })));

  return {
    crewId: text(crewData.id),
    planId: text(crewData.plan_id),
    ownerAccountId: text(crewData.owner_account_id),
    ownerProfileId: owner.profileId,
    visibility: crewData.visibility as RawSocialCrew["visibility"],
    authorityRevision: Number(crewData.authority_revision),
    joinRequestState,
    members,
  };
}

const defaultDependencies: SocialCrewStoreDependencies = {
  async rpc(name, input) {
    const { data, error } = await requireSupabaseAdmin().rpc(name, input);
    if (error) throw new Error(error.message);
    return data;
  },
  loadCrew: loadCrewFromSupabase,
  loadPlan: socialBoundPlanStateResult,
  relationshipBetweenProfiles: socialRelationshipBetweenProfiles,
};

export function createSocialCrewStore(
  dependencies: SocialCrewStoreDependencies = defaultDependencies,
): SocialCrewStore {
  async function write(
    name: SocialCrewRpcName,
    actor: SocialPostActor,
    operation: string,
    key: unknown,
    payload: Record<string, unknown>,
  ): Promise<SocialCrewMutationResult> {
    const input = writeArguments(actor, operation, key, payload);
    try {
      return parseWriteResponse(name, input, await dependencies.rpc(name, input));
    } catch (error) {
      if (error instanceof SocialCrewStoreError) throw error;
      return unavailable();
    }
  }

  return {
    async read(crewId, actor) {
      if (!isUuid(crewId) || !validActor(actor)) return notFound();
      let raw: RawSocialCrew | null;
      try {
        raw = await dependencies.loadCrew(crewId, actor.accountId);
      } catch {
        return unavailable();
      }
      if (!raw) return notFound();
      try {
        validateRawSocialCrew(raw);
      } catch {
        return unavailable();
      }

      const actorAccountMember = raw.members.find((member) =>
        member.state === "active" && member.accountId === actor.accountId
      );
      if (actorAccountMember && actorAccountMember.profileId !== actor.profileId) {
        return notFound();
      }
      const actorMember = raw.members.find((member) =>
        member.state === "active" &&
        member.accountId === actor.accountId &&
        member.profileId === actor.profileId
      );
      const ownerIsViewer = raw.ownerAccountId === actor.accountId && raw.ownerProfileId === actor.profileId;
      if (!actorMember && !ownerIsViewer && raw.visibility === "private") return notFound();
      let relationship: SocialRelationshipResolution;
      if (ownerIsViewer) {
        relationship = "self";
      } else {
        try {
          relationship = await dependencies.relationshipBetweenProfiles(actor.profileId, raw.ownerProfileId);
        } catch {
          return unavailable();
        }
      }
      if (relationship === "unavailable") return unavailable();
      if (actorMember) {
        if (!ownerIsViewer && relationship !== "mutual") return notFound();
      } else if (raw.visibility !== "friends" || relationship !== "mutual") {
        return notFound();
      }

      let planResult: PlanStateLookupResult;
      try {
        planResult = await dependencies.loadPlan(raw.planId, raw.ownerAccountId);
      } catch {
        return unavailable();
      }
      if (!planResult.ok || !planResult.plan) return unavailable();
      try {
        const projected = projectSocialCrewRead(raw, {
          actor,
          ownerRelationship: relationship,
          plan: planResult.plan,
        });
        return projected ?? notFound();
      } catch (error) {
        if (error instanceof SocialCrewStoreError) throw error;
        return unavailable();
      }
    },

    create(actor, input) {
      if (
        !isUuid(input.planId) ||
        typeof input.hostCapability !== "string" ||
        !input.hostCapability.trim() ||
        !isSocialCrewVisibility(input.visibility)
      ) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("create_social_crew_atomic", actor, "create", input.idempotencyKey, {
        p_plan_id: input.planId,
        p_host_token_hash: hashPlanMemberToken(input.hostCapability.trim()),
        p_visibility: input.visibility,
      });
    },

    invite(actor, input) {
      if (!isUuid(input.crewId) || !isUuid(input.targetProfileId)) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("invite_social_crew_member_atomic", actor, "invite", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_target_profile_id: input.targetProfileId,
      });
    },

    acceptInvitation(actor, input) {
      if (!isUuid(input.invitationId) || (input.action !== "accept" && input.action !== "decline")) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("accept_social_crew_invitation_atomic", actor, "invitation-action", input.idempotencyKey, {
        p_invitation_id: input.invitationId,
        p_action: input.action === "accept" ? "accepted" : "declined",
      });
    },

    revokeInvitation(actor, input) {
      if (!isUuid(input.invitationId)) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("revoke_social_crew_invitation_atomic", actor, "invitation-revoke", input.idempotencyKey, {
        p_invitation_id: input.invitationId,
      });
    },

    requestJoin(actor, input) {
      if (!isUuid(input.crewId) || (input.action !== "request" && input.action !== "cancel")) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("request_social_crew_join_atomic", actor, "join-request", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_action: input.action === "request" ? "pending" : "cancelled",
      });
    },

    decideJoin(actor, input) {
      if (!isUuid(input.requestId) || (input.decision !== "accept" && input.decision !== "decline")) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("decide_social_crew_join_request_atomic", actor, "join-decision", input.idempotencyKey, {
        p_request_id: input.requestId,
        p_decision: input.decision === "accept" ? "accepted" : "declined",
      });
    },

    setRole(actor, input) {
      const requestedRole: unknown = input.role;
      if (!isUuid(input.crewId) || !isUuid(input.memberId) || !isSocialCrewRole(requestedRole) || requestedRole === "owner") {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("set_social_crew_role_atomic", actor, "set-role", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_target_member_id: input.memberId,
        p_role: requestedRole,
      });
    },

    transferOwner(actor, input) {
      if (!isUuid(input.crewId) || !isUuid(input.memberId)) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("transfer_social_crew_owner_atomic", actor, "transfer-owner", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_target_member_id: input.memberId,
      });
    },

    removeMember(actor, input) {
      if (!isUuid(input.crewId) || !isUuid(input.memberId)) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("remove_social_crew_member_atomic", actor, "remove-member", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_target_member_id: input.memberId,
      });
    },

    leave(actor, input) {
      if (!isUuid(input.crewId)) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("leave_social_crew_atomic", actor, "leave", input.idempotencyKey, {
        p_crew_id: input.crewId,
      });
    },

    updateVisibility(actor, input) {
      if (
        !isUuid(input.crewId) ||
        !isSocialCrewVisibility(input.visibility) ||
        !Number.isInteger(input.expectedAuthorityRevision) ||
        input.expectedAuthorityRevision < 0
      ) {
        return Promise.reject(new SocialCrewStoreError("INVALID", 400, "Social Crew request is not valid."));
      }
      return write("update_social_crew_visibility_atomic", actor, "visibility", input.idempotencyKey, {
        p_crew_id: input.crewId,
        p_visibility: input.visibility,
        p_expected_authority_revision: input.expectedAuthorityRevision,
      });
    },
  };
}
