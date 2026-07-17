import { createCipheriv, createHash, randomBytes } from "node:crypto";

import {
  type SocialProvider,
  type SocialProviderAvailability,
} from "@/lib/socialConnections";
import { type OAuthConnectionInput } from "@/lib/socialConnectionStore";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

type OAuthState = {
  ownerId: string;
  provider: SocialProvider;
  redirectUri: string;
  codeVerifier: string;
  expiresAt: number;
};

const CLIENT_KEYS: Record<SocialProvider, string> = {
  x: "X_CLIENT_ID",
  instagram: "INSTAGRAM_CLIENT_ID",
  tiktok: "TIKTOK_CLIENT_KEY",
};

const SECRET_KEYS: Record<SocialProvider, string> = {
  x: "X_CLIENT_SECRET",
  instagram: "INSTAGRAM_CLIENT_SECRET",
  tiktok: "TIKTOK_CLIENT_SECRET",
};

/**
 * Server-derived capabilities. A client id alone is not enough to complete an
 * OAuth connection, so the UI only advertises providers with the full secret
 * and encryption configuration required by the callback path.
 */
export function socialProviderAvailability(): SocialProviderAvailability {
  const encrypted = (process.env.SOCIAL_CONNECTION_ENCRYPTION_KEY?.length ?? 0) >= 32;
  const oauthReady = (provider: SocialProvider) =>
    Boolean(process.env[CLIENT_KEYS[provider]] && process.env[SECRET_KEYS[provider]] && encrypted);
  return {
    x: { oauth: oauthReady("x"), manual: false },
    instagram: { oauth: oauthReady("instagram"), manual: true },
    tiktok: { oauth: oauthReady("tiktok"), manual: false },
  };
}

const AUTHORIZE_URLS: Record<SocialProvider, string> = {
  x: "https://twitter.com/i/oauth2/authorize",
  instagram: "https://www.instagram.com/oauth/authorize",
  tiktok: "https://www.tiktok.com/v2/auth/authorize/",
};

const SCOPES: Record<SocialProvider, string[]> = {
  x: ["users.read", "tweet.read", "offline.access"],
  instagram: ["instagram_business_basic"],
  tiktok: ["user.info.basic"],
};

const memoryOAuthStates = new Map<string, OAuthState>();
const stateHash = (token: string) => createHash("sha256").update(token).digest("hex");

async function storeSocialOAuthState(token: string, payload: OAuthState): Promise<void> {
  const hash = stateHash(token);
  if (!isSupabaseConfigured()) {
    for (const [key, state] of memoryOAuthStates) {
      if (state.expiresAt < Date.now() || (state.ownerId === payload.ownerId && state.provider === payload.provider)) {
        memoryOAuthStates.delete(key);
      }
    }
    memoryOAuthStates.set(hash, payload);
    return;
  }
  const admin = requireSupabaseAdmin();
  await admin.from("social_oauth_states").delete().lt("expires_at", new Date().toISOString());
  await admin.from("social_oauth_states").delete().eq("owner_id", payload.ownerId).eq("provider", payload.provider);
  const { error } = await admin.from("social_oauth_states").insert({
    nonce_hash: hash,
    owner_id: payload.ownerId,
    provider: payload.provider,
    redirect_uri: payload.redirectUri,
    code_verifier: payload.codeVerifier,
    expires_at: new Date(payload.expiresAt).toISOString(),
  });
  if (error) throw new Error("OAuth state storage is unavailable.");
}

export async function readSocialOAuthState(token: string, expectedProvider: SocialProvider): Promise<OAuthState> {
  const hash = stateHash(token);
  if (!isSupabaseConfigured()) {
    const payload = memoryOAuthStates.get(hash);
    memoryOAuthStates.delete(hash);
    if (!payload || payload.provider !== expectedProvider || payload.expiresAt < Date.now()) {
      throw new Error("Expired or mismatched OAuth state.");
    }
    return payload;
  }
  const { data, error } = await requireSupabaseAdmin().rpc("consume_social_oauth_state", {
    p_nonce_hash: hash,
    p_provider: expectedProvider,
  });
  const row = data && typeof data === "object" ? data as Record<string, unknown> : null;
  if (error || !row || typeof row.owner_id !== "string" || typeof row.redirect_uri !== "string" || typeof row.code_verifier !== "string") {
    throw new Error("Expired or mismatched OAuth state.");
  }
  return {
    ownerId: row.owner_id,
    provider: expectedProvider,
    redirectUri: row.redirect_uri,
    codeVerifier: row.code_verifier,
    expiresAt: Date.now(),
  };
}

export async function createSocialOAuthStart(input: {
  ownerId: string;
  provider: SocialProvider;
  origin: string;
}): Promise<{ authorizeUrl: string }> {
  if (!socialProviderAvailability()[input.provider].oauth) {
    throw new Error(`${input.provider} OAuth is not configured.`);
  }
  const clientId = process.env[CLIENT_KEYS[input.provider]];
  if (!clientId) throw new Error(`${input.provider} OAuth is not configured.`);
  const redirectUri = `${input.origin}/api/social-connections/${input.provider}/callback`;
  const codeVerifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  await storeSocialOAuthState(state, {
    ownerId: input.ownerId,
    provider: input.provider,
    redirectUri,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1_000,
  });
  const url = new URL(AUTHORIZE_URLS[input.provider]);
  url.searchParams.set(input.provider === "tiktok" ? "client_key" : "client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES[input.provider].join(input.provider === "tiktok" ? "," : " "));
  url.searchParams.set("state", state);
  if (input.provider !== "instagram") {
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", createHash("sha256").update(codeVerifier).digest("base64url"));
  }
  return { authorizeUrl: url.toString() };
}

export function encryptSocialCredential(value: string): string {
  const configured = process.env.SOCIAL_CONNECTION_ENCRYPTION_KEY;
  if (!configured || configured.length < 32) throw new Error("Social credential encryption is not configured.");
  const key = createHash("sha256").update(configured).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export const socialOAuthScopes = (provider: SocialProvider): string[] => [...SCOPES[provider]];

const TOKEN_URLS: Record<SocialProvider, string> = {
  x: "https://api.x.com/2/oauth2/token",
  instagram: "https://api.instagram.com/oauth/access_token",
  tiktok: "https://open.tiktokapis.com/v2/oauth/token/",
};

function clientSecret(provider: SocialProvider): string {
  const secret = process.env[SECRET_KEYS[provider]];
  if (!secret) throw new Error(`${provider} OAuth is not configured.`);
  return secret;
}

async function jsonResponse(response: Response, label: string): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(`${label} failed.`);
  return body;
}

/** Exchange and profile lookup stay server-only; callers receive encrypted credentials. */
export async function completeSocialOAuth(input: {
  provider: SocialProvider;
  code: string;
  state: string;
}): Promise<{ ownerId: string; connection: OAuthConnectionInput }> {
  const state = await readSocialOAuthState(input.state, input.provider);
  const clientId = process.env[CLIENT_KEYS[input.provider]];
  if (!clientId) throw new Error(`${input.provider} OAuth is not configured.`);
  const form = new URLSearchParams({
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: state.redirectUri,
  });
  if (input.provider === "tiktok") form.set("client_key", clientId);
  else form.set("client_id", clientId);
  form.set("client_secret", clientSecret(input.provider));
  if (input.provider !== "instagram") form.set("code_verifier", state.codeVerifier);
  const token = await jsonResponse(
    await fetch(TOKEN_URLS[input.provider], {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
    }),
    "OAuth token exchange",
  );
  const accessToken = typeof token.access_token === "string" ? token.access_token : "";
  if (!accessToken) throw new Error("OAuth provider returned no access token.");

  let accountId = "";
  let username: string | undefined;
  let profileUrl: string | undefined;
  if (input.provider === "x") {
    const profile = await jsonResponse(await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
      headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store",
    }), "X profile lookup");
    const data = (profile.data ?? {}) as Record<string, unknown>;
    accountId = String(data.id ?? "");
    username = typeof data.username === "string" ? data.username : undefined;
    profileUrl = username ? `https://x.com/${username}` : undefined;
  } else if (input.provider === "instagram") {
    const profile = await jsonResponse(await fetch(`https://graph.instagram.com/me?fields=id,username,account_type&access_token=${encodeURIComponent(accessToken)}`, { cache: "no-store" }), "Instagram profile lookup");
    accountId = String(profile.id ?? "");
    username = typeof profile.username === "string" ? profile.username : undefined;
    profileUrl = username ? `https://www.instagram.com/${username}/` : undefined;
  } else {
    const profile = await jsonResponse(await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username", {
      headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store",
    }), "TikTok profile lookup");
    const user = ((profile.data ?? {}) as Record<string, unknown>).user as Record<string, unknown> | undefined;
    accountId = String(user?.open_id ?? "");
    username = typeof user?.username === "string" ? user.username : undefined;
    profileUrl = username ? `https://www.tiktok.com/@${username}` : undefined;
  }
  if (!accountId) throw new Error("OAuth provider returned no account id.");
  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : Number(token.expires_in);
  return {
    ownerId: state.ownerId,
    connection: {
      provider: input.provider,
      accountKind: "professional",
      providerAccountId: accountId,
      ...(username ? { username } : {}),
      ...(profileUrl ? { profileUrl } : {}),
      scopes: socialOAuthScopes(input.provider),
      accessTokenCiphertext: encryptSocialCredential(accessToken),
      ...(typeof token.refresh_token === "string" ? { refreshTokenCiphertext: encryptSocialCredential(token.refresh_token) } : {}),
      ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { tokenExpiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString() } : {}),
    },
  };
}
