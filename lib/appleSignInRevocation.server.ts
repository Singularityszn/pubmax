import "server-only";

// Apple's token revocation for Sign in with Apple (App Review 5.1.1(v)).
// Account deletion calls this so the app leaves the person's "Apps Using Apple
// ID" list. Each call mints its own short-lived client secret, so there is no
// six-month secret here to expire. The Supabase provider secret is separate.

import type { AppleToken } from "@/lib/appleSignInToken";
import { signEs256Jwt } from "@/lib/es256Jwt.server";

/** The Services ID that Supabase's Apple provider lists first. Apple issued the tokens to it. */
export const APPLE_SIGN_IN_CLIENT_ID = "com.pubmaxx.app.web";
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const APPLE_AUDIENCE = "https://appleid.apple.com";
const CLIENT_SECRET_LIFETIME_S = 300;
const REVOKE_TIMEOUT_MS = 5000;

export type AppleRevokeResult =
  | { status: "revoked" }
  | { status: "not_configured" }
  | { status: "failed"; reason: string };

type AppleSignInEnv = Partial<
  Record<"APPLE_SIGN_IN_TEAM_ID" | "APPLE_SIGN_IN_KEY_ID" | "APPLE_SIGN_IN_PRIVATE_KEY", string>
>;

export type AppleRevokeDeps = {
  fetch?: typeof fetch;
  env?: AppleSignInEnv;
  /** Millisecond clock for the client secret's `iat`. */
  nowMs?: number;
};

/** Apple's OAuth error code, when the body carries a plain one. Never the token. */
async function appleErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    return typeof body?.error === "string" && /^[a-z_]{1,64}$/.test(body.error) ? `:${body.error}` : "";
  } catch {
    return "";
  }
}

/** Revoke one Apple token. Never throws, and no answer it gives contains the token. */
export async function revokeAppleToken(token: AppleToken, deps: AppleRevokeDeps = {}): Promise<AppleRevokeResult> {
  const env = deps.env ?? process.env;
  const teamId = env.APPLE_SIGN_IN_TEAM_ID?.trim();
  const keyId = env.APPLE_SIGN_IN_KEY_ID?.trim();
  const privateKey = env.APPLE_SIGN_IN_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!teamId || !keyId || !privateKey) return { status: "not_configured" };

  const iat = Math.floor((deps.nowMs ?? Date.now()) / 1000);
  let clientSecret: string;
  try {
    clientSecret = signEs256Jwt(
      keyId,
      { iss: teamId, iat, exp: iat + CLIENT_SECRET_LIFETIME_S, aud: APPLE_AUDIENCE, sub: APPLE_SIGN_IN_CLIENT_ID },
      privateKey,
    );
  } catch {
    return { status: "failed", reason: "client_secret_unsigned" };
  }

  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(APPLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: APPLE_SIGN_IN_CLIENT_ID,
        client_secret: clientSecret,
        token: token.value,
        token_type_hint: token.type,
      }).toString(),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
  } catch (err) {
    return { status: "failed", reason: `network:${err instanceof Error ? err.name : "unknown"}` };
  }
  if (response.ok) return { status: "revoked" };
  return { status: "failed", reason: `http_${response.status}${await appleErrorCode(response)}` };
}
