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

function setSessionCookie(token: string): Headers {
  const headers = new Headers();
  const secure = process.env.NODE_ENV === "production";
  headers.append(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(hashAdminSession(token))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_SESSION_MAX_AGE_SEC}${secure ? "; Secure" : ""}`,
  );
  return headers;
}

function clearSessionCookie(): Headers {
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
  return headers;
}

export async function GET(request: Request): Promise<Response> {
  return jsonNoStore({ authenticated: isModerator(request) }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
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
