import { createHash, randomBytes } from "node:crypto";

import {
  REFERRAL_ATTRIBUTION_DAYS,
  REFERRAL_GRANT_GATE,
  REFERRAL_MILESTONES,
  referralFeatureForMilestone,
  referralFeaturesGrantedBy,
  type ReferralFeature,
  type ReferralMilestone,
  type ReferralRewardEvent,
} from "@/lib/referrals";
import {
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

const DAY_MS = 24 * 60 * 60 * 1_000;
const JOURNEY_TTL_MS = REFERRAL_ATTRIBUTION_DAYS * DAY_MS;
const MAX_MEMORY_CODES = 50_000;
const MAX_MEMORY_JOURNEYS = 100_000;
const MAX_MEMORY_EDGES = 100_000;

export type ReferralContributionKind =
  | "community_price"
  | "visit_report"
  | "recommendation";

export type ReferralEarnedReward = ReferralRewardEvent & {
  event: "milestone_earned";
  grantStatus: "blocked_identity";
  earnedAt: string;
  qualifiedCount: number;
};

export type ReferralPrivateStatus = {
  attributedCount: number;
  qualifiedCount: number;
  earned: ReferralEarnedReward[];
  grantedFeatures: ReferralFeature[];
  grantsEnabled: false;
  nextMilestone: ReferralMilestone | null;
};

export type RecordEdgeResult =
  | { ok: true; status: "recorded" | "existing"; edgeId: string }
  | {
      ok: false;
      reason:
        | "self"
        | "circular"
        | "already_attributed"
        | "deleted_identity"
        | "storage";
    };

export type ClaimJourneyResult =
  | RecordEdgeResult
  | {
      ok: false;
      reason:
        | "unknown"
        | "expired"
        | "consumed"
        | "account_predates_journey";
    };

export type QualifyReferralResult =
  | { ok: true; status: "qualified" | "existing" }
  | { ok: false; reason: "no_edge" | "deleted_identity" | "storage" };

export class ReferralIdentityDeletedError extends Error {
  constructor() {
    super("Referral actions are unavailable for this account.");
    this.name = "ReferralIdentityDeletedError";
  }
}

export type ReferralStore = {
  getOrCreateInviteCode(
    inviterUserId: string,
    now?: number,
  ): Promise<{ code: string }>;
  startJourney(
    code: string,
    existingToken?: string | null,
    now?: number,
  ): Promise<{ token: string; expiresAt: string } | null>;
  claimJourney(input: {
    token: string;
    inviteeUserId: string;
    inviteeCreatedAt: string;
    now?: number;
  }): Promise<ClaimJourneyResult>;
  recordEdge(
    inviterUserId: string,
    inviteeUserId: string,
    attributedAt?: number,
  ): Promise<RecordEdgeResult>;
  qualify(input: {
    inviteeUserId: string;
    contributionKind: ReferralContributionKind;
    contributionId: string;
    acceptedAt?: number;
  }): Promise<QualifyReferralResult>;
  privateStatus(inviterUserId: string): Promise<ReferralPrivateStatus>;
  eraseAccount(userId: string): Promise<void>;
};

type MemoryInviteCode = {
  inviterUserId: string;
  rawCode: string;
  createdAt: number;
};

type MemoryJourney = {
  inviterUserId: string;
  startedAt: number;
  expiresAt: number;
  consumedBy: string | null;
};

type MemoryEdge = {
  id: string;
  inviterUserId: string;
  inviteeUserId: string;
  attributedAt: number;
};

type MemoryQualification = {
  edgeId: string;
  contributionKind: ReferralContributionKind;
  contributionId: string;
  acceptedAt: number;
};

const inviteCodeByInviter = new Map<string, MemoryInviteCode>();
const inviterByCodeHash = new Map<string, string>();
const journeyByTokenHash = new Map<string, MemoryJourney>();
const edgeByInvitee = new Map<string, MemoryEdge>();
const edgeById = new Map<string, MemoryEdge>();
const qualificationsByEdge = new Map<string, MemoryQualification>();
const erasedReferralIdentities = new Set<string>();
type MemoryLedgerRow = ReferralEarnedReward & {
  triggeringEdgeId: string;
};

const ledgerByInviter = new Map<string, MemoryLedgerRow[]>();

function opaqueToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cleanId(value: string): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedInsert<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.set(key, value);
  if (map.size <= max) return;
  const oldest = map.keys().next().value as K | undefined;
  if (oldest !== undefined) map.delete(oldest);
}

function emptyStatus(): ReferralPrivateStatus {
  return {
    attributedCount: 0,
    qualifiedCount: 0,
    earned: [],
    grantedFeatures: [],
    grantsEnabled: false,
    nextMilestone: 1,
  };
}

function earnedRowsFor(
  inviterUserId: string,
  qualifiedCount: number,
  triggeringEdgeId: string,
  now: number,
): MemoryLedgerRow[] {
  const current = ledgerByInviter.get(inviterUserId) ?? [];
  const recorded = new Set(current.map((entry) => entry.milestone));
  const additions: MemoryLedgerRow[] = [];
  for (const milestone of REFERRAL_MILESTONES) {
    if (qualifiedCount < milestone || recorded.has(milestone)) continue;
    additions.push({
      event: "milestone_earned",
      feature: referralFeatureForMilestone(milestone),
      milestone,
      permanent: true,
      grantStatus: "blocked_identity",
      earnedAt: new Date(now).toISOString(),
      qualifiedCount,
      triggeringEdgeId,
    });
  }
  if (additions.length > 0) {
    ledgerByInviter.set(inviterUserId, [...current, ...additions]);
  }
  return additions;
}

export const memoryReferralStore: ReferralStore = {
  async getOrCreateInviteCode(inviterUserId, now = Date.now()) {
    const inviter = cleanId(inviterUserId);
    if (erasedReferralIdentities.has(inviter)) {
      throw new ReferralIdentityDeletedError();
    }
    const existing = inviteCodeByInviter.get(inviter);
    if (existing) return { code: existing.rawCode };
    const rawCode = opaqueToken(18);
    const record = { inviterUserId: inviter, rawCode, createdAt: now };
    inviteCodeByInviter.set(inviter, record);
    if (inviteCodeByInviter.size > MAX_MEMORY_CODES) {
      const oldestInviter = inviteCodeByInviter.keys().next().value as
        | string
        | undefined;
      const oldest = oldestInviter
        ? inviteCodeByInviter.get(oldestInviter)
        : null;
      if (oldestInviter) inviteCodeByInviter.delete(oldestInviter);
      if (oldest) inviterByCodeHash.delete(tokenHash(oldest.rawCode));
    }
    inviterByCodeHash.set(tokenHash(rawCode), inviter);
    return { code: rawCode };
  },

  async startJourney(code, existingToken = null, now = Date.now()) {
    if (existingToken) {
      const existing = journeyByTokenHash.get(tokenHash(existingToken));
      if (
        existing &&
        !erasedReferralIdentities.has(existing.inviterUserId) &&
        !existing.consumedBy &&
        existing.expiresAt >= now
      ) {
        return {
          token: existingToken,
          expiresAt: new Date(existing.expiresAt).toISOString(),
        };
      }
    }

    const inviterUserId = inviterByCodeHash.get(tokenHash(code));
    if (!inviterUserId || erasedReferralIdentities.has(inviterUserId)) {
      return null;
    }
    const token = opaqueToken();
    const expiresAt = now + JOURNEY_TTL_MS;
    boundedInsert(
      journeyByTokenHash,
      tokenHash(token),
      {
        inviterUserId,
        startedAt: now,
        expiresAt,
        consumedBy: null,
      },
      MAX_MEMORY_JOURNEYS,
    );
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  },

  async claimJourney({
    token,
    inviteeUserId,
    inviteeCreatedAt,
    now = Date.now(),
  }) {
    if (erasedReferralIdentities.has(cleanId(inviteeUserId))) {
      return { ok: false, reason: "deleted_identity" };
    }
    const journey = journeyByTokenHash.get(tokenHash(token));
    if (!journey) return { ok: false, reason: "unknown" };
    if (journey.expiresAt < now) return { ok: false, reason: "expired" };
    if (journey.consumedBy && journey.consumedBy !== inviteeUserId) {
      return { ok: false, reason: "consumed" };
    }
    const createdAt = Date.parse(inviteeCreatedAt);
    if (!Number.isFinite(createdAt) || createdAt < journey.startedAt) {
      return { ok: false, reason: "account_predates_journey" };
    }
    const result = await memoryReferralStore.recordEdge(
      journey.inviterUserId,
      inviteeUserId,
      now,
    );
    if (result.ok) journey.consumedBy = inviteeUserId;
    return result;
  },

  async recordEdge(inviterUserId, inviteeUserId, attributedAt = Date.now()) {
    const inviter = cleanId(inviterUserId);
    const invitee = cleanId(inviteeUserId);
    if (!inviter || !invitee) return { ok: false, reason: "storage" };
    if (
      erasedReferralIdentities.has(inviter) ||
      erasedReferralIdentities.has(invitee)
    ) {
      return { ok: false, reason: "deleted_identity" };
    }
    if (inviter === invitee) return { ok: false, reason: "self" };
    const existing = edgeByInvitee.get(invitee);
    if (existing) {
      return existing.inviterUserId === inviter
        ? { ok: true, status: "existing", edgeId: existing.id }
        : { ok: false, reason: "already_attributed" };
    }
    const reverse = edgeByInvitee.get(inviter);
    if (reverse?.inviterUserId === invitee) {
      return { ok: false, reason: "circular" };
    }
    if (edgeByInvitee.size >= MAX_MEMORY_EDGES) {
      return { ok: false, reason: "storage" };
    }
    const edge: MemoryEdge = {
      id: `ref-${opaqueToken(12)}`,
      inviterUserId: inviter,
      inviteeUserId: invitee,
      attributedAt,
    };
    edgeByInvitee.set(invitee, edge);
    edgeById.set(edge.id, edge);
    return { ok: true, status: "recorded", edgeId: edge.id };
  },

  async qualify({
    inviteeUserId,
    contributionKind,
    contributionId,
    acceptedAt = Date.now(),
  }) {
    const invitee = cleanId(inviteeUserId);
    if (erasedReferralIdentities.has(invitee)) {
      return { ok: false, reason: "deleted_identity" };
    }
    const edge = edgeByInvitee.get(invitee);
    if (!edge) return { ok: false, reason: "no_edge" };
    if (erasedReferralIdentities.has(edge.inviterUserId)) {
      return { ok: false, reason: "deleted_identity" };
    }
    if (qualificationsByEdge.has(edge.id)) {
      return { ok: true, status: "existing" };
    }
    qualificationsByEdge.set(edge.id, {
      edgeId: edge.id,
      contributionKind,
      contributionId,
      acceptedAt,
    });
    let qualifiedCount = 0;
    for (const qualifiedEdgeId of qualificationsByEdge.keys()) {
      const candidate = edgeById.get(qualifiedEdgeId);
      if (candidate?.inviterUserId === edge.inviterUserId) qualifiedCount += 1;
    }
    earnedRowsFor(edge.inviterUserId, qualifiedCount, edge.id, acceptedAt);
    return { ok: true, status: "qualified" };
  },

  async privateStatus(inviterUserId) {
    const inviter = cleanId(inviterUserId);
    if (!inviter || erasedReferralIdentities.has(inviter)) return emptyStatus();
    const edges = [...edgeByInvitee.values()].filter(
      (edge) => edge.inviterUserId === inviter,
    );
    const qualifiedCount = edges.filter((edge) =>
      qualificationsByEdge.has(edge.id)
    ).length;
    const earned: ReferralEarnedReward[] = (
      ledgerByInviter.get(inviter) ?? []
    ).map((entry) => ({
      event: entry.event,
      feature: entry.feature,
      milestone: entry.milestone,
      permanent: entry.permanent,
      grantStatus: entry.grantStatus,
      earnedAt: entry.earnedAt,
      qualifiedCount: entry.qualifiedCount,
    }));
    const nextMilestone =
      REFERRAL_MILESTONES.find((milestone) => milestone > qualifiedCount) ?? null;
    return {
      attributedCount: edges.length,
      qualifiedCount,
      earned,
      grantedFeatures: referralFeaturesGrantedBy(earned),
      grantsEnabled: REFERRAL_GRANT_GATE.enabled,
      nextMilestone,
    };
  },

  async eraseAccount(userId) {
    const user = cleanId(userId);
    if (!user) return;
    erasedReferralIdentities.add(user);

    const removedEdgeIds = new Set<string>();
    for (const edge of edgeById.values()) {
      if (edge.inviterUserId === user || edge.inviteeUserId === user) {
        removedEdgeIds.add(edge.id);
      }
    }
    for (const edgeId of removedEdgeIds) {
      const edge = edgeById.get(edgeId);
      if (edge) edgeByInvitee.delete(edge.inviteeUserId);
      edgeById.delete(edgeId);
      qualificationsByEdge.delete(edgeId);
    }

    for (const [inviter, rows] of ledgerByInviter) {
      if (inviter === user) {
        ledgerByInviter.delete(inviter);
        continue;
      }
      const retained = rows.filter(
        (row) => !removedEdgeIds.has(row.triggeringEdgeId),
      );
      if (retained.length > 0) ledgerByInviter.set(inviter, retained);
      else ledgerByInviter.delete(inviter);
    }

    for (const [hash, journey] of journeyByTokenHash) {
      if (journey.inviterUserId === user || journey.consumedBy === user) {
        journeyByTokenHash.delete(hash);
      }
    }
    const inviteCode = inviteCodeByInviter.get(user);
    if (inviteCode) {
      inviterByCodeHash.delete(tokenHash(inviteCode.rawCode));
      inviteCodeByInviter.delete(user);
    }
  },
};

const { guard, resetWarnings } = createFailSoftGuard({
  tag: "referrals",
  tables: [
    "referral_erasure_blocks",
    "referral_invite_codes",
    "referral_attribution_journeys",
    "referral_edges",
    "referral_qualification_events",
    "pro_feature_unlock_ledger",
  ],
  migrationHint: "apply migration 0060",
});

function missingReferralStorageFallback<T>(
  fallback: () => Promise<T>,
): Promise<T> {
  return onMissingDurableWrite({
    storeTag: "referrals",
    migrationHint: "apply migration 0060",
    fallback,
  });
}

function objectRow(data: unknown): Record<string, unknown> {
  if (Array.isArray(data)) return (data[0] ?? {}) as Record<string, unknown>;
  return data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
}

function recordEdgeResult(data: unknown): RecordEdgeResult {
  const row = objectRow(data);
  if (row.ok === true) {
    return {
      ok: true,
      status: row.status === "existing" ? "existing" : "recorded",
      edgeId: String(row.edge_id ?? ""),
    };
  }
  const reason = row.reason;
  if (
    reason === "self" ||
    reason === "circular" ||
    reason === "already_attributed" ||
    reason === "deleted_identity"
  ) {
    return { ok: false, reason };
  }
  return { ok: false, reason: "storage" };
}

export const supabaseReferralStore: ReferralStore = {
  async getOrCreateInviteCode(inviterUserId, now = Date.now()) {
    return guard({
      context: "invite-code",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.getOrCreateInviteCode(inviterUserId, now)
        ),
      run: async () => {
        const rawCode = opaqueToken(18);
        const { data, error } = await requireSupabaseAdmin().rpc(
          "get_or_create_referral_invite_code",
          {
            p_inviter_user_id: inviterUserId,
            p_code_hash: tokenHash(rawCode),
            p_code_token: rawCode,
            p_created_at: new Date(now).toISOString(),
          },
        );
        if (error) throw new Error(error.message);
        const row = objectRow(data);
        if (row.reason === "deleted_identity") {
          throw new ReferralIdentityDeletedError();
        }
        const code = typeof row.code === "string" ? row.code : "";
        if (!code) throw new Error("Referral invite code was not returned.");
        return { code };
      },
    });
  },

  async startJourney(code, existingToken = null, now = Date.now()) {
    return guard({
      context: "start-journey",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.startJourney(code, existingToken, now)
        ),
      run: async () => {
        const token = opaqueToken();
        const { data, error } = await requireSupabaseAdmin().rpc(
          "start_referral_journey",
          {
            p_code_hash: tokenHash(code),
            p_existing_token_hash: existingToken
              ? tokenHash(existingToken)
              : null,
            p_new_token_hash: tokenHash(token),
            p_now: new Date(now).toISOString(),
            p_expires_at: new Date(now + JOURNEY_TTL_MS).toISOString(),
          },
        );
        if (error) throw new Error(error.message);
        const row = objectRow(data);
        if (row.ok !== true) return null;
        const retained = row.retained === true;
        return {
          token: retained && existingToken ? existingToken : token,
          expiresAt: String(row.expires_at),
        };
      },
    });
  },

  async claimJourney(input) {
    return guard({
      context: "claim-journey",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.claimJourney(input)
        ),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin().rpc(
          "claim_referral_journey",
          {
            p_token_hash: tokenHash(input.token),
            p_invitee_user_id: input.inviteeUserId,
            p_invitee_created_at: input.inviteeCreatedAt,
            p_now: new Date(input.now ?? Date.now()).toISOString(),
          },
        );
        if (error) throw new Error(error.message);
        const row = objectRow(data);
        if (row.ok === true) return recordEdgeResult(row);
        const reason = row.reason;
        if (
          reason === "unknown" ||
          reason === "expired" ||
          reason === "consumed" ||
          reason === "account_predates_journey"
        ) {
          return { ok: false, reason };
        }
        return recordEdgeResult(row);
      },
    });
  },

  async recordEdge(inviterUserId, inviteeUserId, attributedAt = Date.now()) {
    return guard({
      context: "record-edge",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.recordEdge(
            inviterUserId,
            inviteeUserId,
            attributedAt,
          )
        ),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin().rpc(
          "record_referral_edge",
          {
            p_inviter_user_id: inviterUserId,
            p_invitee_user_id: inviteeUserId,
            p_attributed_at: new Date(attributedAt).toISOString(),
          },
        );
        if (error) throw new Error(error.message);
        return recordEdgeResult(data);
      },
    });
  },

  async qualify(input) {
    return guard({
      context: "qualify",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.qualify(input)
        ),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin().rpc(
          "qualify_referral_from_contribution",
          {
            p_invitee_user_id: input.inviteeUserId,
            p_contribution_kind: input.contributionKind,
            p_contribution_id: input.contributionId,
            p_accepted_at: new Date(input.acceptedAt ?? Date.now()).toISOString(),
          },
        );
        if (error) throw new Error(error.message);
        const row = objectRow(data);
        if (row.ok === true) {
          return {
            ok: true,
            status: row.status === "existing" ? "existing" : "qualified",
          };
        }
        return {
          ok: false,
          reason:
            row.reason === "no_edge" || row.reason === "deleted_identity"
              ? row.reason
              : "storage",
        };
      },
    });
  },

  async privateStatus(inviterUserId) {
    return guard({
      context: "private-status",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.privateStatus(inviterUserId)
        ),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin().rpc(
          "read_private_referral_status",
          { p_inviter_user_id: inviterUserId },
        );
        if (error) throw new Error(error.message);
        const row = objectRow(data);
        const earnedRaw = Array.isArray(row.earned) ? row.earned : [];
        const earned = earnedRaw.filter(
          (item): item is ReferralEarnedReward =>
            Boolean(item && typeof item === "object"),
        );
        const qualifiedCount = Number(row.qualified_count ?? 0);
        return {
          attributedCount: Number(row.attributed_count ?? 0),
          qualifiedCount,
          earned,
          grantedFeatures: referralFeaturesGrantedBy(earned),
          grantsEnabled: false,
          nextMilestone:
            REFERRAL_MILESTONES.find(
              (milestone) => milestone > qualifiedCount,
            ) ?? null,
        };
      },
    });
  },

  async eraseAccount(userId) {
    return guard({
      context: "erase-account",
      onSchemaMiss: () =>
        missingReferralStorageFallback(() =>
          memoryReferralStore.eraseAccount(userId)
        ),
      run: async () => {
        const { error } = await requireSupabaseAdmin().rpc(
          "erase_referral_account",
          { p_user_id: userId },
        );
        if (error) throw new Error(error.message);
      },
    });
  },
};

export function referralStore(): ReferralStore {
  return selectStore(memoryReferralStore, supabaseReferralStore);
}

export function __resetMemoryReferrals(): void {
  inviteCodeByInviter.clear();
  inviterByCodeHash.clear();
  journeyByTokenHash.clear();
  edgeByInvitee.clear();
  edgeById.clear();
  qualificationsByEdge.clear();
  ledgerByInviter.clear();
  erasedReferralIdentities.clear();
  resetWarnings();
}
