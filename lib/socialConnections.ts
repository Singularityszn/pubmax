export const SOCIAL_PROVIDERS = ["x", "instagram", "tiktok"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
export type SocialConnectionMode = "oauth" | "manual";
export type SocialAccountKind = "personal" | "professional";

export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === "string" && SOCIAL_PROVIDERS.includes(value as SocialProvider);
}

export type StoredSocialConnection = {
  id: string;
  ownerId: string;
  provider: SocialProvider;
  mode: SocialConnectionMode;
  accountKind: SocialAccountKind;
  providerAccountId?: string;
  username?: string;
  profileUrl?: string;
  scopes: string[];
  accessTokenCiphertext?: string;
  refreshTokenCiphertext?: string;
  tokenExpiresAt?: string;
  connectedAt: string;
  updatedAt: string;
};

export type PublicSocialConnection = {
  provider: SocialProvider;
  mode: SocialConnectionMode;
  accountKind: SocialAccountKind;
  status: "connected" | "action_required";
  username?: string;
  profileUrl?: string;
  scopes: string[];
  connectedAt: string;
  updatedAt: string;
};

/** Public DTO allow-list. Provider ids and credential material never cross it. */
export function publicSocialConnection(row: StoredSocialConnection): PublicSocialConnection {
  return {
    provider: row.provider,
    mode: row.mode,
    accountKind: row.accountKind,
    status:
      row.mode === "manual" || !row.tokenExpiresAt || Date.parse(row.tokenExpiresAt) > Date.now()
        ? "connected"
        : "action_required",
    ...(row.username ? { username: row.username } : {}),
    ...(row.profileUrl ? { profileUrl: row.profileUrl } : {}),
    scopes: [...row.scopes],
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
  };
}

export type ManualSocialProfileInput = {
  provider: SocialProvider;
  accountKind: SocialAccountKind;
  profileUrl: unknown;
};

export type ManualSocialProfileResult =
  | { ok: true; username: string; profileUrl: string }
  | { ok: false; error: string };

export function validateManualSocialProfile(
  input: ManualSocialProfileInput,
): ManualSocialProfileResult {
  if (input.provider !== "instagram" || input.accountKind !== "personal") {
    return { ok: false, error: "Manual links are available only for personal Instagram accounts." };
  }
  if (typeof input.profileUrl !== "string" || input.profileUrl.length > 300) {
    return { ok: false, error: "Add a valid Instagram profile URL." };
  }
  try {
    const url = new URL(input.profileUrl.trim());
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const segments = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "https:" || hostname !== "instagram.com" || segments.length !== 1) {
      return { ok: false, error: "Add a valid Instagram profile URL." };
    }
    const username = segments[0];
    if (!/^[a-z0-9._]{1,30}$/i.test(username)) {
      return { ok: false, error: "Add a valid Instagram profile URL." };
    }
    return {
      ok: true,
      username,
      profileUrl: `https://www.instagram.com/${username}/`,
    };
  } catch {
    return { ok: false, error: "Add a valid Instagram profile URL." };
  }
}
