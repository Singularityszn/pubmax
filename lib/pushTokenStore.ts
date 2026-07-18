// Device push-token registry for the Capacitor native shell. ONE interface,
// TWO implementations (process-memory + Supabase public.push_tokens), same
// seam pattern as the other stores (lib/storeBackend.ts). A token row is keyed
// by the token string itself — re-registering the same device is an idempotent
// upsert that refreshes last_seen_at, never a duplicate.
//
// No auth: registration happens before sign-in (the shell registers on boot),
// so a row carries no identity — it is only "this device can receive pushes".

import { admin, selectStore } from "@/lib/storeBackend";

export type PushPlatform = "ios" | "android";

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

export const MAX_TOKEN_LENGTH = 512;

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
  if (platform !== "ios" && platform !== "android") {
    return { ok: false, error: "Platform must be ios or android." };
  }
  return { ok: true, input: { token, platform } };
}

export type PushTokenStore = {
  /** Register (or refresh) a device token. Idempotent per token. */
  save(input: PushTokenInput): Promise<PushTokenDTO>;
  /** All registered device tokens. The send fan-out (lib/pushSender.ts) reads
   *  this to resolve broadcast targets. Rows carry no identity, so this is the
   *  ONLY targeting available until tokens gain identity — see pushSender. */
  list(): Promise<PushTokenDTO[]>;
  /** Remove a token the push provider reported invalid (APNs 410 /
   *  BadDeviceToken). Idempotent — deleting an absent token is a no-op. */
  delete(token: string): Promise<void>;
};

const TABLE = "push_tokens";

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
      platform: data.platform === "android" ? "android" : "ios",
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
      platform: row.platform === "android" ? "android" : "ios",
      createdAt: String(row.created_at),
      lastSeenAt: String(row.last_seen_at),
    }));
  },
  async delete(token) {
    const { error } = await admin().from(TABLE).delete().eq("token", token);
    if (error) throw new Error(error.message);
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
const memoryTokens = new Map<string, PushTokenDTO>();

export const memoryPushTokenStore: PushTokenStore = {
  async save(input) {
    const now = new Date().toISOString();
    const existing = memoryTokens.get(input.token);
    const dto: PushTokenDTO = {
      token: input.token,
      platform: input.platform,
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
    };
    memoryTokens.set(input.token, dto);
    return dto;
  },
  async list() {
    return [...memoryTokens.values()];
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
  return [...memoryTokens.values()];
}

/** Test-only: clear the in-memory registry between cases. */
export function __resetMemoryPushTokens(): void {
  memoryTokens.clear();
}
