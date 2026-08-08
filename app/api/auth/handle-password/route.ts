// Handle + password sign-in. Resolves handle → auth email server-side, performs
// the Supabase password grant here, and returns session tokens in the same shape
// as /api/auth/session redeem. The email never crosses to the browser.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  encodeAuthResumeCookie,
  AUTH_RESUME_COOKIE,
  AUTH_RESUME_MAX_AGE_SECONDS,
} from "@/lib/authSessionResume";
import {
  HANDLE_PASSWORD_GENERIC_ERROR,
  MIN_HANDLE_PASSWORD_LENGTH,
} from "@/lib/handlePasswordConstants";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";
import { cleanText } from "@/lib/textClean";
import {
  resolveAuthEmailForHandle,
  signInWithEmailPassword,
} from "@/lib/handlePasswordSignIn";

assertServerEnv();

const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 15 * 60 * 1000;

function isCrossSite(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "cross-site";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

function setResumeCookie(refreshToken: string, email: string | null): Headers {
  const headers = new Headers();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const value = encodeURIComponent(
    encodeAuthResumeCookie({ refreshToken, email }),
  );
  headers.append(
    "Set-Cookie",
    `${AUTH_RESUME_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_RESUME_MAX_AGE_SECONDS}${secure}`,
  );
  return headers;
}

export async function POST(request: Request): Promise<Response> {
  if (isCrossSite(request)) {
    return publicApiError("Cross-site requests are not accepted.", "FORBIDDEN", 403);
  }

  const rateKey = `auth-handle-password:${hashIp(clientIp(request))}`;
  if (
    await isLimited(rateKey, rateKey, RATE_LIMIT, RATE_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError("Too many sign-in attempts. Try again shortly.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  if (!isSupabaseConfigured()) {
    return publicApiError("Sign-in is not configured.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const handle = cleanText(body.handle, 30);
  const password = typeof body.password === "string" ? body.password : "";
  if (!handle || password.length < MIN_HANDLE_PASSWORD_LENGTH) {
    return publicApiError(HANDLE_PASSWORD_GENERIC_ERROR, "INVALID_CREDENTIALS", 401);
  }

  let email: string | null;
  try {
    email = await resolveAuthEmailForHandle(handle);
  } catch {
    return publicApiError("Sign-in is not available right now.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  if (!email) {
    return publicApiError(HANDLE_PASSWORD_GENERIC_ERROR, "INVALID_CREDENTIALS", 401);
  }

  const session = await signInWithEmailPassword(email, password);
  if (!session) {
    return publicApiError(HANDLE_PASSWORD_GENERIC_ERROR, "INVALID_CREDENTIALS", 401);
  }

  return jsonNoStore(
    {
      status: "signed_in",
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        expires_at: session.expires_at,
        token_type: session.token_type,
      },
    },
    { headers: setResumeCookie(session.refresh_token, email) },
  );
}
