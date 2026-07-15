import {
  type SocialAccountKind,
  type SocialProvider,
  type StoredSocialConnection,
} from "@/lib/socialConnections";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

export type OAuthConnectionInput = {
  provider: SocialProvider;
  accountKind: SocialAccountKind;
  providerAccountId: string;
  username?: string;
  profileUrl?: string;
  scopes: string[];
  accessTokenCiphertext: string;
  refreshTokenCiphertext?: string;
  tokenExpiresAt?: string;
};

export type ManualConnectionInput = {
  provider: "instagram";
  username: string;
  profileUrl: string;
};

export type SocialConnectionStore = {
  list(ownerId: string): Promise<StoredSocialConnection[]>;
  saveManual(ownerId: string, input: ManualConnectionInput): Promise<StoredSocialConnection>;
  saveOAuth(ownerId: string, input: OAuthConnectionInput): Promise<StoredSocialConnection>;
  disconnect(ownerId: string, provider: SocialProvider): Promise<void>;
};

const memoryRows = new Map<string, StoredSocialConnection>();
const memoryKey = (ownerId: string, provider: SocialProvider) => `${ownerId}:${provider}`;

function fromRow(row: Record<string, unknown>): StoredSocialConnection {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    provider: String(row.provider) as SocialProvider,
    mode: String(row.mode) as "oauth" | "manual",
    accountKind: String(row.account_kind) as SocialAccountKind,
    ...(row.provider_account_id ? { providerAccountId: String(row.provider_account_id) } : {}),
    ...(row.username ? { username: String(row.username) } : {}),
    ...(row.profile_url ? { profileUrl: String(row.profile_url) } : {}),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    ...(row.access_token_ciphertext ? { accessTokenCiphertext: String(row.access_token_ciphertext) } : {}),
    ...(row.refresh_token_ciphertext ? { refreshTokenCiphertext: String(row.refresh_token_ciphertext) } : {}),
    ...(row.token_expires_at ? { tokenExpiresAt: String(row.token_expires_at) } : {}),
    connectedAt: String(row.connected_at),
    updatedAt: String(row.updated_at),
  };
}

export const memorySocialConnectionStore: SocialConnectionStore = {
  async list(ownerId) {
    return [...memoryRows.values()].filter((row) => row.ownerId === ownerId);
  },
  async saveManual(ownerId, input) {
    const now = new Date().toISOString();
    const key = memoryKey(ownerId, input.provider);
    const row: StoredSocialConnection = {
      id: memoryRows.get(key)?.id ?? `mem-social-${key}`,
      ownerId,
      provider: input.provider,
      mode: "manual",
      accountKind: "personal",
      username: input.username,
      profileUrl: input.profileUrl,
      scopes: [],
      connectedAt: memoryRows.get(key)?.connectedAt ?? now,
      updatedAt: now,
    };
    memoryRows.set(key, row);
    return row;
  },
  async saveOAuth(ownerId, input) {
    const now = new Date().toISOString();
    const key = memoryKey(ownerId, input.provider);
    const row: StoredSocialConnection = {
      id: memoryRows.get(key)?.id ?? `mem-social-${key}`,
      ownerId,
      mode: "oauth",
      connectedAt: memoryRows.get(key)?.connectedAt ?? now,
      updatedAt: now,
      ...input,
    };
    memoryRows.set(key, row);
    return row;
  },
  async disconnect(ownerId, provider) {
    memoryRows.delete(memoryKey(ownerId, provider));
  },
};

export const supabaseSocialConnectionStore: SocialConnectionStore = {
  async list(ownerId) {
    const { data, error } = await requireSupabaseAdmin()
      .from("external_social_accounts")
      .select("*")
      .eq("owner_id", ownerId)
      .order("provider");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
  },
  async saveManual(ownerId, input) {
    const now = new Date().toISOString();
    const { data, error } = await requireSupabaseAdmin()
      .from("external_social_accounts")
      .upsert({
        owner_id: ownerId,
        provider: input.provider,
        mode: "manual",
        account_kind: "personal",
        provider_account_id: null,
        username: input.username,
        profile_url: input.profileUrl,
        scopes: [],
        access_token_ciphertext: null,
        refresh_token_ciphertext: null,
        token_expires_at: null,
        updated_at: now,
      }, { onConflict: "owner_id,provider" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data as Record<string, unknown>);
  },
  async saveOAuth(ownerId, input) {
    const now = new Date().toISOString();
    const { data, error } = await requireSupabaseAdmin()
      .from("external_social_accounts")
      .upsert({
        owner_id: ownerId,
        provider: input.provider,
        mode: "oauth",
        account_kind: input.accountKind,
        provider_account_id: input.providerAccountId,
        username: input.username ?? null,
        profile_url: input.profileUrl ?? null,
        scopes: input.scopes,
        access_token_ciphertext: input.accessTokenCiphertext,
        refresh_token_ciphertext: input.refreshTokenCiphertext ?? null,
        token_expires_at: input.tokenExpiresAt ?? null,
        updated_at: now,
      }, { onConflict: "owner_id,provider" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data as Record<string, unknown>);
  },
  async disconnect(ownerId, provider) {
    const { error } = await requireSupabaseAdmin()
      .from("external_social_accounts")
      .delete()
      .eq("owner_id", ownerId)
      .eq("provider", provider);
    if (error) throw new Error(error.message);
  },
};

export function socialConnectionStore(): SocialConnectionStore {
  return isSupabaseConfigured() ? supabaseSocialConnectionStore : memorySocialConnectionStore;
}

export function __resetMemorySocialConnections(): void {
  memoryRows.clear();
}
