import "server-only";

import { createHash } from "node:crypto";

import { needsAdultSelfAssertion } from "@/lib/adultGate";
import { adultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import { verifyCallerAuth } from "@/lib/authServer";
import {
  authResumeCookieFromHeader,
  authResumeSetCookie,
  decodeAuthResumeCookie,
  isPlausibleRefreshToken,
  type AuthResumeCookiePayload,
} from "@/lib/authSessionResume";
import {
  decideFriendsLaunchSocialAccess,
  type SocialAccessState,
  type SocialProductAccount,
} from "@/lib/socialAccess";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
} from "@/lib/socialLaunch";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { requireSupabaseAdmin } from "@/lib/supabase";

type SupabaseSessionVerification =
  | { status: "absent" }
  | { status: "unavailable" }
  | {
      status: "verified";
      userId: string;
      /** Set-Cookie value carrying the rotated refresh token (see below). */
      resumeCookie?: string;
      /** SHA-256 of that rotated token, so its next request reads the memory. */
      rotatedKey?: string;
    };

/**
 * Present only when the resume-cookie lane spent the cookie's refresh token on
 * this request. A route hands it back with `withAuthResumeCookie`, on whatever
 * it answers, so the browser keeps the token GoTrue rotated to.
 */
type SocialResumeCookie = { resumeCookie?: string };

type FriendsLaunchAccessRecord = {
  account: SocialProductAccount | null;
  profile: { id: string; handle: string } | null;
  dateOfBirth: string | null;
  /** Recorded one-tap assertion (migration 0103), or null. */
  adultSelfAssertedAt?: string | null;
};

type ProvisionStoreResult =
  | { ok: true; productAccountId: string; provisioned: boolean }
  | {
      ok: false;
      reason:
        | "profile_not_claimed"
        | "ownership_conflict"
        | "invalid"
        | "storage";
    };

export type SocialAccessServerDependencies = {
  friendsLaunchEnabled: boolean;
  now: () => Date;
  verifySupabaseSession: (request?: Request) => Promise<SupabaseSessionVerification>;
  readFriendsLaunchAccess: (supabaseUserId: string) => Promise<FriendsLaunchAccessRecord>;
};

export type SocialAccessResolution = (
  | {
      available: true;
      state: Exclude<SocialAccessState, "verified">;
      /**
       * True only when the one tap is the way through: the account has neither
       * a stored date of birth nor a recorded assertion. A stored date of birth
       * that says under 18 leaves this false, so the surface never offers a
       * button that would not be honoured.
       */
      adultPrompt?: boolean;
    }
  | { available: true; state: "verified"; actor: SocialPostActor }
  | {
      available: false;
      state: "preview";
      code: "SOCIAL_ACCESS_UNAVAILABLE";
      error: string;
      retryable: true;
    }
) & SocialResumeCookie;

const GOTRUE_TIMEOUT_MS = 10_000;

function supabaseAuthConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

// THE COOKIE LANE SPENDS A REFRESH TOKEN, SO IT KEEPS THE ROTATED ONE AND ASKS
// ONCE PER PAGE. An `<img src="/api/social/media/...">` never carries a bearer,
// so every Social photo comes down this lane. Redeeming the cookie's token
// rotates it at GoTrue: the rotated token is written back to the cookie, or the
// cookie falls a generation behind on every image and GoTrue's reuse detection
// eventually revokes the whole session. And a page of N photos would make N
// refreshes from our shared egress IPs, spending GoTrue's per-IP refresh budget
// for everybody, so one redeem per presented token is shared: concurrent
// requests join the in-flight promise, and a verified user id is remembered for
// RESUME_VERIFY_TTL_MS, keyed by a SHA-256 of the token (the token itself is
// never kept). Only a verified answer is remembered; a refusal, a 429 or an
// outage asks again next time.
//
// The trade-off is a ban: GoTrue refuses a banned account's refresh, and a
// remembered answer skips that question for up to the TTL on this instance. A
// request whose bearer GoTrue has just called banned never reads the memory,
// so the window only stays open for a caller sending no bearer at all.
const RESUME_VERIFY_TTL_MS = 60_000;
const RESUME_VERIFY_MAX_ENTRIES = 500;
const resumeVerified = new Map<string, { userId: string; expiresAt: number }>();
const resumeInFlight = new Map<string, Promise<SupabaseSessionVerification>>();

function resumeTokenKey(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex");
}

function rememberResumeVerification(key: string, userId: string): void {
  const now = Date.now();
  if (resumeVerified.size >= RESUME_VERIFY_MAX_ENTRIES) {
    for (const [entryKey, entry] of resumeVerified) {
      if (entry.expiresAt <= now) resumeVerified.delete(entryKey);
    }
  }
  while (resumeVerified.size >= RESUME_VERIFY_MAX_ENTRIES) {
    const oldest = resumeVerified.keys().next().value;
    if (oldest === undefined) break;
    resumeVerified.delete(oldest);
  }
  resumeVerified.set(key, { userId, expiresAt: now + RESUME_VERIFY_TTL_MS });
}

async function redeemResumeRefreshToken(
  payload: AuthResumeCookiePayload & { refreshToken: string },
  config: { url: string; key: string },
): Promise<SupabaseSessionVerification> {
  try {
    const response = await fetch(
      new URL("/auth/v1/token?grant_type=refresh_token", config.url),
      {
        method: "POST",
        headers: {
          apikey: config.key,
          "content-type": "application/json",
        },
        body: JSON.stringify({ refresh_token: payload.refreshToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(GOTRUE_TIMEOUT_MS),
      },
    );
    if (!response.ok) return { status: "absent" };
    const session = (await response.json()) as Record<string, unknown>;
    const user =
      session.user && typeof session.user === "object"
        ? (session.user as Record<string, unknown>)
        : null;
    const userId = user && typeof user.id === "string" ? user.id : null;
    if (!userId) return { status: "unavailable" };
    // The same rewrite `/api/auth/session` redeem makes: the rotated token,
    // the session's own email and account id.
    const nextRefreshToken = session.refresh_token;
    if (!isPlausibleRefreshToken(nextRefreshToken)) {
      return { status: "verified", userId };
    }
    return {
      status: "verified",
      userId,
      rotatedKey: resumeTokenKey(nextRefreshToken),
      resumeCookie: authResumeSetCookie({
        refreshToken: nextRefreshToken,
        email: typeof user?.email === "string" ? user.email : payload.email,
        userId,
      }),
    };
  } catch {
    return { status: "unavailable" };
  }
}

async function verifySupabaseSessionFromRequest(
  request?: Request,
): Promise<SupabaseSessionVerification> {
  let bearerBanned = false;
  if (request) {
    const bearer = await verifyCallerAuth(request);
    if (bearer.status === "verified") {
      return { status: "verified", userId: bearer.identity.id };
    }
    if (bearer.status === "unavailable") return { status: "unavailable" };
    bearerBanned = bearer.status === "banned";
  }
  if (!request) return { status: "absent" };

  const payload = decodeAuthResumeCookie(
    authResumeCookieFromHeader(request.headers.get("cookie")),
  );
  if (!payload?.refreshToken) return { status: "absent" };

  const config = supabaseAuthConfig();
  if (!config) return { status: "unavailable" };

  const refreshToken = payload.refreshToken;
  const key = resumeTokenKey(refreshToken);
  if (bearerBanned) {
    resumeVerified.delete(key);
    return redeemResumeRefreshToken({ ...payload, refreshToken }, config);
  }
  const remembered = resumeVerified.get(key);
  if (remembered && remembered.expiresAt > Date.now()) {
    return { status: "verified", userId: remembered.userId };
  }
  if (remembered) resumeVerified.delete(key);
  const inFlight = resumeInFlight.get(key);
  if (inFlight) return inFlight;

  // Every request joining this promise gets the same rotated cookie back. The
  // memory keeps only the user id, so a later hit sets no cookie: the browser
  // already holds the rotated token from the first answer.
  const pending = redeemResumeRefreshToken({ ...payload, refreshToken }, config)
    .then((result) => {
      if (result.status === "verified") {
        rememberResumeVerification(key, result.userId);
        // The browser's next image carries the token GoTrue just minted for
        // this same user, so it is remembered too: a scrolling feed then makes
        // one refresh per TTL rather than one per batch of photos.
        if (result.rotatedKey) rememberResumeVerification(result.rotatedKey, result.userId);
      }
      return result;
    })
    .finally(() => {
      resumeInFlight.delete(key);
    });
  resumeInFlight.set(key, pending);
  return pending;
}

function rowObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function provisionSocialAccount(
  supabaseUserId: string,
): Promise<ProvisionStoreResult> {
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "provision_social_product_account",
      { p_supabase_user_id: supabaseUserId },
    );
    if (error) return { ok: false, reason: "storage" };
    const result = rowObject(Array.isArray(data) ? data[0] : data);
    if (result?.ok === true && typeof result.product_account_id === "string") {
      return {
        ok: true,
        productAccountId: result.product_account_id,
        provisioned: result.provisioned === true,
      };
    }
    return {
      ok: false,
      reason:
        result?.code === "profile_not_claimed"
          ? "profile_not_claimed"
          : result?.code === "ownership_conflict"
            ? "ownership_conflict"
            : result?.code === "invalid"
              ? "invalid"
              : "storage",
    };
  } catch {
    return { ok: false, reason: "storage" };
  }
}

async function readFriendsLaunchAccess(
  supabaseUserId: string,
): Promise<FriendsLaunchAccessRecord> {
  const provision = await provisionSocialAccount(supabaseUserId);
  if (!provision.ok) {
    if (provision.reason === "profile_not_claimed") {
      return { account: null, profile: null, dateOfBirth: null };
    }
    throw new Error("Invalid Social friends-launch account state.");
  }

  const admin = requireSupabaseAdmin();
  const { data: accountRows, error: accountError } = await admin
    .from("private_social_accounts")
    .select("id,clerk_user_id,profile_id,ownership_state")
    .eq("id", provision.productAccountId)
    .limit(1);
  if (accountError) throw new Error(accountError.message);
  const accountRow = rowObject((accountRows ?? [])[0]);
  if (
    !accountRow ||
    typeof accountRow.id !== "string" ||
    typeof accountRow.profile_id !== "string" ||
    typeof accountRow.clerk_user_id !== "string" ||
    !["active", "suspended"].includes(String(accountRow.ownership_state))
  ) {
    throw new Error("Invalid Social account state.");
  }

  const account: SocialProductAccount = {
    id: accountRow.id,
    ownershipState:
      accountRow.ownership_state === "suspended" ? "suspended" : "active",
  };

  const { data: profileRows, error: profileError } = await admin
    .from("profiles")
    .select("id,handle,user_id")
    .eq("id", accountRow.profile_id)
    .limit(1);
  if (profileError) throw new Error(profileError.message);
  const profileRow = rowObject((profileRows ?? [])[0]);
  if (
    !profileRow ||
    profileRow.id !== accountRow.profile_id ||
    profileRow.user_id !== supabaseUserId ||
    typeof profileRow.handle !== "string" ||
    !profileRow.handle.trim()
  ) {
    throw new Error("Invalid Social profile ownership state.");
  }
  const profile = {
    id: profileRow.id as string,
    handle: profileRow.handle.trim(),
  };

  const { data: identityRows, error: identityError } = await admin
    .from("private_account_identities")
    .select("date_of_birth")
    .eq("user_id", supabaseUserId)
    .limit(1);
  if (identityError) throw new Error(identityError.message);
  const identityRow = rowObject((identityRows ?? [])[0]);
  const rawDob = identityRow?.date_of_birth;
  const dateOfBirth =
    typeof rawDob === "string" && rawDob.trim() ? rawDob.trim() : null;

  // The second half of the age answer. An account claimed through the early
  // handle path has no identity row at all, so this is the lane it comes in by.
  const adultSelfAssertedAt = await adultSelfAssertionStore().read(
    supabaseUserId,
  );

  return { account, profile, dateOfBirth, adultSelfAssertedAt };
}

function readDefaultDependencies(
  env: Record<string, string | undefined> = process.env,
): SocialAccessServerDependencies {
  return {
    friendsLaunchEnabled: isSocialFriendsLaunchEnabled(
      env[SOCIAL_FRIENDS_LAUNCH_ENV],
    ),
    now: () => new Date(),
    verifySupabaseSession: verifySupabaseSessionFromRequest,
    readFriendsLaunchAccess,
  };
}

function unavailableAccess(): SocialAccessResolution {
  return {
    available: false,
    state: "preview",
    code: "SOCIAL_ACCESS_UNAVAILABLE",
    error: "Social access checks are unavailable right now.",
    retryable: true,
  };
}

export async function resolveSocialAccess(
  request?: Request,
  dependencies?: SocialAccessServerDependencies,
): Promise<SocialAccessResolution> {
  return (await resolveSocialAccessFor(request, dependencies)).access;
}

// The resolution plus, when the state is verified, the auth user id the
// session verified. That id stays on the server: the access route hands the
// resolution to the browser, and its shape does not change.
async function resolveSocialAccessFor(
  request?: Request,
  dependencies?: SocialAccessServerDependencies,
): Promise<{ access: SocialAccessResolution; authUserId: string | null }> {
  const deps = dependencies ?? readDefaultDependencies();
  const without = (access: SocialAccessResolution) => ({ access, authUserId: null });
  if (!deps.friendsLaunchEnabled) return without({ available: true, state: "preview" });
  const supabase = await deps.verifySupabaseSession(request);
  if (supabase.status === "unavailable") return without(unavailableAccess());
  if (supabase.status === "absent") {
    return without({ available: true, state: "sign_in_required" });
  }
  const resumeCookie: SocialResumeCookie = supabase.resumeCookie
    ? { resumeCookie: supabase.resumeCookie }
    : {};
  try {
    const { account, profile, dateOfBirth, adultSelfAssertedAt } =
      await deps.readFriendsLaunchAccess(supabase.userId);
    const state = decideFriendsLaunchSocialAccess({
      friendsLaunchEnabled: deps.friendsLaunchEnabled,
      supabaseUserId: supabase.userId,
      claimedHandle: profile?.handle ?? null,
      dateOfBirth,
      adultSelfAssertedAt: adultSelfAssertedAt ?? null,
      ownershipState: account?.ownershipState ?? null,
      now: deps.now(),
    });
    if (state === "verified") {
      if (!account || !profile || account.id === "" || profile.id === "" || profile.handle === "") {
        return without({ ...unavailableAccess(), ...resumeCookie });
      }
      return {
        access: {
          available: true,
          state,
          actor: { accountId: account.id, profileId: profile.id, handle: profile.handle },
          ...resumeCookie,
        },
        authUserId: supabase.userId,
      };
    }
    return without({
      available: true,
      state,
      ...resumeCookie,
      ...(state === "age_verification_required"
        ? {
            adultPrompt:
              Boolean(profile?.handle?.trim()) &&
              needsAdultSelfAssertion({
                dateOfBirth,
                adultSelfAssertedAt: adultSelfAssertedAt ?? null,
              }),
          }
        : {}),
    });
  } catch {
    return without({ ...unavailableAccess(), ...resumeCookie });
  }
}

export type VerifiedSocialActorResolution = (
  | {
      ok: true;
      actor: SocialPostActor;
      /**
       * The auth user id this session verified (`profiles.user_id`). It is a
       * different domain from `actor.accountId`, the private Social account
       * record's own id, which provisioning gives a UUID of its own. A check
       * that reads the auth owner, such as handle ownership through
       * `identityHandleStore().ownedHandle`, takes this one.
       */
      authUserId: string;
    }
  | {
      ok: false;
      status: 401 | 403 | 503;
      code:
        | "SOCIAL_SIGN_IN_REQUIRED"
        | "SOCIAL_ADULT_VERIFICATION_REQUIRED"
        | "SOCIAL_ACCOUNT_SUSPENDED"
        | "SOCIAL_ACCESS_UNAVAILABLE";
      error: string;
      retryable?: true;
    }
) & SocialResumeCookie;

export async function requireVerifiedSocialActor(
  request?: Request,
  dependencies?: SocialAccessServerDependencies,
): Promise<VerifiedSocialActorResolution> {
  const deps = dependencies ?? readDefaultDependencies();
  const { access, authUserId } = await resolveSocialAccessFor(request, deps);
  const resumeCookie: SocialResumeCookie = access.resumeCookie
    ? { resumeCookie: access.resumeCookie }
    : {};
  if (!access.available) {
    return {
      ok: false,
      status: 503,
      code: access.code,
      error: access.error,
      retryable: true,
      ...resumeCookie,
    };
  }
  if (access.state === "verified" && authUserId) {
    return { ok: true, actor: access.actor, authUserId, ...resumeCookie };
  }
  if (access.state === "verified") {
    return {
      ok: false,
      status: 503,
      code: "SOCIAL_ACCESS_UNAVAILABLE",
      error: "Social access checks are unavailable right now.",
      retryable: true,
      ...resumeCookie,
    };
  }
  if (access.state === "preview") {
    return { ok: false, status: 503, code: "SOCIAL_ACCESS_UNAVAILABLE", error: "Social is not open yet.", ...resumeCookie };
  }
  if (access.state === "sign_in_required") {
    return { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social.", ...resumeCookie };
  }
  if (access.state === "suspended") {
    return { ok: false, status: 403, code: "SOCIAL_ACCOUNT_SUSPENDED", error: "Social access is suspended.", ...resumeCookie };
  }
  return {
    ok: false,
    status: 403,
    code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
    error: "Adult verification is needed for Social.",
    ...resumeCookie,
  };
}
