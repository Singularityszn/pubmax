// Admin session — exchanges a one-time moderator token for an httpOnly cookie so
// the admin console never persists the raw ADMIN_TOKEN in localStorage.

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SEC,
  hashAdminSession,
  isModerator,
  verifyAdminToken,
} from "@/lib/adminAuth";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

const SESSION_ATTEMPT_LIMIT = 10;
const SESSION_ATTEMPT_WINDOW_MS = 60_000;

function setSessionCookie(token: string): Headers {
  const headers = new Headers();
  const secure = process.env.NODE_ENV === "production";
  headers.append(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(hashAdminSession(token))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_MAX_AGE_SEC}${secure ? "; Secure" : ""}`,
  );
  return headers;
}

function clearSessionCookie(): Headers {
  const headers = new Headers();
  const secure = process.env.NODE_ENV === "production";
  headers.append(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`,
  );
  return headers;
}

export async function GET(request: Request): Promise<Response> {
  return jsonNoStore({ authenticated: isModerator(request) }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  const ipKey = hashIp(clientIp(request));
  if (
    await isLimited(
      `admin-session:${ipKey}`,
      `admin-session:${ipKey}`,
      SESSION_ATTEMPT_LIMIT,
      SESSION_ATTEMPT_WINDOW_MS,
    )
  ) {
    return jsonNoStore({ error: "Too many attempts, slow down." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Invalid JSON." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  if (!token || !verifyAdminToken(token)) {
    return jsonNoStore({ error: "Not authorised." }, { status: 403 });
  }

  const headers = setSessionCookie(token);
  return jsonNoStore({ ok: true }, { status: 200, headers });
}

export async function DELETE(): Promise<Response> {
  const headers = clearSessionCookie();
  return jsonNoStore({ ok: true }, { status: 200, headers });
}
