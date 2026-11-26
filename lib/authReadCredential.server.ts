import "server-only";

// The Social read credential — an HMAC-signed HttpOnly cookie that lets the
// server authenticate ambient GET requests (an <img> carries no bearer)
// WITHOUT spending the refresh token the browser and the resume cookie share.
//
// WHY THIS EXISTS: issue #3114. GoTrue revokes the whole session when a
// refresh token is reused outside its rules, and the Social cookie lane used
// to redeem the resume cookie's refresh token per request while the browser's
// Supabase client refreshed the same chain. Two parties spent one token and
// neither could see the other's spend. Now only `/api/auth/session` ever moves
// the refresh token: it mints this credential on every verified persist and
// redeem, and the cookie lane verifies the signature locally. One owner spends
// the token; the reads borrow a proof, not the token.
//
// The trade-off is the revocation window: a ban stops minting at once, but a
// credential already on a device reads for its remaining TTL. That window is
// bounded to GET and HEAD — RESUME_COOKIE_METHODS in lib/socialAccessServer.ts
// keeps every write on a bearer GoTrue checks each request.

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  isTrustedSigningKeyUnavailableError,
  trustedSigningKey,
} from "@/lib/trustedSigningKey.server";

export const AUTH_READ_COOKIE = "pubmax_session_read";

/** Bound on both the revocation window and a stale-account read. */
const AUTH_READ_TTL_MS = 24 * 60 * 60 * 1000;

const CREDENTIAL_VERSION = 1;
const MAX_CREDENTIAL_LENGTH = 512;
const MAX_USER_ID_LENGTH = 128;

type ReadCredentialClaims = { v: number; uid: string; exp: number };

function isPlausibleUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_USER_ID_LENGTH &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

function signature(encoded: string): Buffer {
  return createHmac("sha256", trustedSigningKey())
    .update(`auth-read:v${CREDENTIAL_VERSION}:${encoded}`)
    .digest();
}

/**
 * Mint the read credential for a session the server has just verified.
 * Returns null when there is no account to name — and when the signing key
 * itself is unavailable, so an unconfigured deploy clears the credential and
 * the lane fails closed rather than 500-ing a sign-in.
 */
export function mintAuthReadCredential(
  userId: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!isPlausibleUserId(userId) || !userId.trim()) return null;
  const claims: ReadCredentialClaims = {
    v: CREDENTIAL_VERSION,
    uid: userId,
    exp: now + AUTH_READ_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  try {
    return `${encoded}.${signature(encoded).toString("base64url")}`;
  } catch (error) {
    if (isTrustedSigningKeyUnavailableError(error)) return null;
    throw error;
  }
}

/** The account a credential speaks for, or null for anything not minted here. */
export function verifyAuthReadCredential(
  raw: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!raw || raw.length > MAX_CREDENTIAL_LENGTH) return null;
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0]);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return null;
    }
    const claims = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as Partial<ReadCredentialClaims>;
    if (claims.v !== CREDENTIAL_VERSION) return null;
    if (!isPlausibleUserId(claims.uid)) return null;
    if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp)) return null;
    if (claims.exp <= now) return null;
    return claims.uid;
  } catch {
    return null;
  }
}

/** The Set-Cookie value that writes the read credential, or deletes it given null. */
export function authReadSetCookie(
  userId: string | null,
  now: number = Date.now(),
): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const credential = userId ? mintAuthReadCredential(userId, now) : null;
  const value = credential ? encodeURIComponent(credential) : "";
  const maxAge = credential ? Math.floor(AUTH_READ_TTL_MS / 1000) : 0;
  return `${AUTH_READ_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/**
 * Extract the read credential from a Cookie request header. Anything malformed
 * reads as absent — the same contract authResumeCookieFromHeader keeps, and
 * for the same reason: this runs outside the verification try in
 * verifySupabaseSessionFromRequest, so a junk value must not throw.
 */
export function authReadCredentialFromHeader(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== AUTH_READ_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}
