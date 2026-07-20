// Push registry for the Capacitor shell and installed web app.
// ONE interface, TWO storage implementations (process-memory + Supabase
// public.push_tokens), same seam pattern as the other stores. A row is keyed by
// its opaque native token / serialized web subscription; re-registration is an
// idempotent last_seen_at refresh.
//
// Registration remains identity-free: native registration happens before
// sign-in and web registration only after explicit browser permission. Separate
// server-authorised joins may later associate that existing registration with a
// claimed account or verified Plan membership. Those joins never make identity
// part of the public DTO or the broadcast list.

import { admin, selectStore } from "@/lib/storeBackend";
import { decodeWebPushSubscription } from "@/lib/webPushSubscription";

export type PushPlatform = "ios" | "android" | "web";

export type PushTokenDTO = {
  token: string;
  platform: PushPlatform;
  createdAt: string;
  lastSeenAt: string;
};

export type PushTokenInput = { token: string; platform: PushPlatform };

export type PushTokenValidation =
  | { ok: true; input: PushTokenInput }
  | { ok: false; error: string };

export const MAX_TOKEN_LENGTH = 2_048;

/** Validate an untrusted { token, platform } payload from the shell. */
export function validatePushToken(raw: {
  token?: unknown;
  platform?: unknown;
}): PushTokenValidation {
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  if (!token) return { ok: false, error: "A device token is required." };
  if (token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: `Token is too long (max ${MAX_TOKEN_LENGTH} characters).` };
  }
  const platform = raw.platform;
  if (platform !== "ios" && platform !== "android" && platform !== "web") {
    return { ok: false, error: "Platform must be ios, android or web." };
  }
  if (platform === "web" && !decodeWebPushSubscription(token)) {
    return { ok: false, error: "Web token must contain a valid push subscription." };
  }
  if (platform !== "web" && decodeWebPushSubscription(token)) {
    return { ok: false, error: "Web push subscriptions must use the web platform." };
  }
  return { ok: true, input: { token, platform } };
}

export type PushTokenStore = {
  /** Register (or refresh) a device token. Idempotent per token. */
  save(input: PushTokenInput): Promise<PushTokenDTO>;
  /** All registered device tokens. Public city-wide broadcasts use this list;
   * identity joins do not change that identity-free behaviour. */
  list(): Promise<PushTokenDTO[]>;
  /** Tokens linked to a VERIFIED claimed account. Server-internal only. */
  listForAccount(userId: string): Promise<PushTokenDTO[]>;
  /** Tokens linked by a VERIFIED member capability to this Plan. Server-internal only. */
  listForPlan(planId: string): Promise<PushTokenDTO[]>;
  /** Atomically link an existing registration to one claimed account. A token
   * can never be reassigned while another account owns its link. */
  linkAccount(token: string, userId: string, sessionId: string): Promise<PushIdentityJoinResult>;
  /** Remove only the caller's account link. Missing/wrong-owner rows are the
   * same idempotent result so the endpoint cannot enumerate registrations. */
  unlinkAccount(token: string, userId: string, sessionId: string): Promise<void>;
  /** Privacy/account-erasure seam: clear every link for one verified account. */
  unlinkAllForAccount(userId: string): Promise<void>;
  /** Link one existing registration to one verified member per Plan. */
  linkPlan(token: string, planId: string, memberId: string): Promise<PushIdentityJoinResult>;
  /** Remove only the matching verified member's Plan link, idempotently. */
  unlinkPlan(token: string, planId: string, memberId: string): Promise<void>;
  /** Remove a token the push provider reported invalid (APNs 410 /
   *  BadDeviceToken). Idempotent — deleting an absent token is a no-op. */
  delete(token: string): Promise<void>;
};

export type PushIdentityJoinResult = "linked" | "replayed" | "conflict" | "missing" | "error";

const TABLE = "push_tokens";
const PLAN_LINKS = "push_token_plan_memberships";

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabasePushTokenStore: PushTokenStore = {
  async save(input) {
    const now = new Date().toISOString();
    const { data, error } = await admin()
      .from(TABLE)
      .upsert(
        { token: input.token, platform: input.platform, last_seen_at: now },
        { onConflict: "token" },
      )
      .select("token, platform, created_at, last_seen_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      token: String(data.token),
      platform: data.platform === "web" ? "web" : data.platform === "android" ? "android" : "ios",
      createdAt: String(data.created_at),
      lastSeenAt: String(data.last_seen_at),
    };
  },
  async list() {
    const { data, error } = await admin()
      .from(TABLE)
      .select("token, platform, created_at, last_seen_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      token: String(row.token),
      platform: row.platform === "web" ? "web" : row.platform === "android" ? "android" : "ios",
      createdAt: String(row.created_at),
      lastSeenAt: String(row.last_seen_at),
    }));
  },
  async listForAccount(userId) {
    if (!userId) return [];
    const { data, error } = await admin()
      .from(TABLE)
      .select("token, platform, created_at, last_seen_at")
      .eq("account_user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(tokenFromRow);
  },
  async listForPlan(planId) {
    if (!planId) return [];
    const { data, error } = await admin()
      .from(PLAN_LINKS)
      .select("linked_at,push_tokens!inner(token,platform,created_at,last_seen_at)")
      .eq("plan_id", planId)
      .order("linked_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).flatMap((link) => {
      const related = (link as Record<string, unknown>).push_tokens;
      const row = Array.isArray(related) ? related[0] : related;
      return row && typeof row === "object" ? [tokenFromRow(row as Record<string, unknown>)] : [];
    });
  },
  async linkAccount(token, userId, sessionId) {
    const { data, error } = await admin().rpc("link_push_token_account_atomic", {
      p_token: token,
      p_user_id: userId,
      p_session_id: sessionId,
      p_linked_at: new Date().toISOString(),
    });
    if (error) return "error";
    return joinResult(data);
  },
  async unlinkAccount(token, userId, sessionId) {
    const { error } = await admin().rpc("unlink_push_token_account_atomic", {
      p_token: token,
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (error) throw new Error(error.message);
  },
  async unlinkAllForAccount(userId) {
    const { error } = await admin().rpc("unlink_all_push_tokens_for_account", {
      p_user_id: userId,
    });
    if (error) throw new Error(error.message);
  },
  async linkPlan(token, planId, memberId) {
    const { data, error } = await admin().rpc("link_push_token_plan_member_atomic", {
      p_token: token,
      p_plan_id: planId,
      p_member_id: memberId,
      p_linked_at: new Date().toISOString(),
    });
    if (error) return "error";
    return joinResult(data);
  },
  async unlinkPlan(token, planId, memberId) {
    const { error } = await admin().rpc("unlink_push_token_plan_member_atomic", {
      p_token: token,
      p_plan_id: planId,
      p_member_id: memberId,
    });
    if (error) throw new Error(error.message);
  },
  async delete(token) {
    const { error } = await admin().from(TABLE).delete().eq("token", token);
    if (error) throw new Error(error.message);
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
type MemoryRegistration = {
  registration: PushTokenDTO;
  accountUserId: string | null;
  accountSessionId: string | null;
  blockedAccountSessionId: string | null;
  planMembers: Map<string, string>;
};

const memoryTokens = new Map<string, MemoryRegistration>();

function tokenFromRow(row: Record<string, unknown>): PushTokenDTO {
  return {
    token: String(row.token),
    platform: row.platform === "web" ? "web" : row.platform === "android" ? "android" : "ios",
    createdAt: String(row.created_at),
    lastSeenAt: String(row.last_seen_at),
  };
}

function joinResult(value: unknown): PushIdentityJoinResult {
  return value === "linked" || value === "replayed" || value === "conflict" || value === "missing"
    ? value
    : "error";
}

export const memoryPushTokenStore: PushTokenStore = {
  async save(input) {
    const now = new Date().toISOString();
    const existing = memoryTokens.get(input.token);
    const dto: PushTokenDTO = {
      token: input.token,
      platform: input.platform,
      createdAt: existing?.registration.createdAt ?? now,
      lastSeenAt: now,
    };
    memoryTokens.set(input.token, {
      registration: dto,
      accountUserId: existing?.accountUserId ?? null,
      accountSessionId: existing?.accountSessionId ?? null,
      blockedAccountSessionId: existing?.blockedAccountSessionId ?? null,
      planMembers: existing?.planMembers ?? new Map(),
    });
    return dto;
  },
  async list() {
    return [...memoryTokens.values()].map((row) => ({ ...row.registration }));
  },
  async listForAccount(userId) {
    return [...memoryTokens.values()]
      .filter((row) => row.accountUserId === userId)
      .map((row) => ({ ...row.registration }));
  },
  async listForPlan(planId) {
    return [...memoryTokens.values()]
      .filter((row) => row.planMembers.has(planId))
      .map((row) => ({ ...row.registration }));
  },
  async linkAccount(token, userId, sessionId) {
    const row = memoryTokens.get(token);
    if (!row) return "missing";
    if (row.accountUserId === userId && row.accountSessionId === sessionId) return "replayed";
    if (row.blockedAccountSessionId === sessionId) return "conflict";
    if (row.accountUserId && row.accountUserId !== userId) return "conflict";
    row.accountUserId = userId;
    row.accountSessionId = sessionId;
    return "linked";
  },
  async unlinkAccount(token, userId, sessionId) {
    const row = memoryTokens.get(token);
    if (row?.accountUserId === userId && row.accountSessionId === sessionId) {
      row.accountUserId = null;
      row.accountSessionId = null;
      row.blockedAccountSessionId = sessionId;
    }
  },
  async unlinkAllForAccount(userId) {
    for (const row of memoryTokens.values()) {
      if (row.accountUserId === userId) {
        row.blockedAccountSessionId = row.accountSessionId;
        row.accountUserId = null;
        row.accountSessionId = null;
      }
    }
  },
  async linkPlan(token, planId, memberId) {
    const row = memoryTokens.get(token);
    if (!row) return "missing";
    const existing = row.planMembers.get(planId);
    if (existing === memberId) return "replayed";
    if (existing) return "conflict";
    row.planMembers.set(planId, memberId);
    return "linked";
  },
  async unlinkPlan(token, planId, memberId) {
    const row = memoryTokens.get(token);
    if (row?.planMembers.get(planId) === memberId) row.planMembers.delete(planId);
  },
  async delete(token) {
    memoryTokens.delete(token);
  },
};

/** The single backend selection point (mirrors the other stores). */
export function pushTokenStore(): PushTokenStore {
  return selectStore(memoryPushTokenStore, supabasePushTokenStore);
}

/** Test-only: current in-memory registrations (insertion order). */
export function __listMemoryPushTokens(): PushTokenDTO[] {
  return [...memoryTokens.values()].map((row) => ({ ...row.registration }));
}

/** Test-only: clear the in-memory registry between cases. */
export function __resetMemoryPushTokens(): void {
  memoryTokens.clear();
}
