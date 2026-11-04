import "server-only";

// The top-ten share link. A ranking is private (ADR 0017, lib/socialPubRankings.ts),
// so the shared page never reads the live list. When the owner taps "Share your
// top ten", the server signs the ten venue ids as they stand at that moment and
// hands back a link carrying the signature. The page and its card render that
// signed list and nothing else: a later change to the ranking does not reach an
// old link, and nobody can build a link for somebody else's list, because only
// the owner's own read can mint one.

import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeHandle } from "@/lib/profiles";
import { TOP_TEN } from "@/lib/profilePassport";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

const TOKEN_VERSION = 1;
const TOKEN_MAX_LENGTH = 2_000;
const VENUE_ID = /^[A-Za-z0-9:_.-]{1,100}$/;

type TopTenClaims = { v: typeof TOKEN_VERSION; h: string; ids: string[]; iat: number };

export type VerifiedTopTen = { handle: string; venueIds: string[]; issuedAt: number };

function signature(encoded: string): Buffer {
  return createHmac("sha256", trustedSigningKey())
    .update(`passport-top-ten:v${TOKEN_VERSION}:${encoded}`)
    .digest();
}

function cleanIds(ids: readonly string[]): string[] | null {
  const out = [...new Set(ids.map((id) => id.trim()))];
  if (out.length < 1 || out.length > TOP_TEN) return null;
  return out.every((id) => VENUE_ID.test(id)) ? out : null;
}

/** Sign the owner's list as it stands. Throws when the input is not a list. */
export function mintTopTenShare(handle: string, venueIds: readonly string[], now = Date.now()): string {
  const h = normalizeHandle(handle);
  const ids = cleanIds(venueIds);
  if (!h || !ids) throw new Error("A top-ten share needs a handle and one to ten venues.");
  const claims: TopTenClaims = { v: TOKEN_VERSION, h, ids, iat: now };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded).toString("base64url")}`;
}

/** The signed list, only when the token is ours and names this handle. */
export function verifyTopTenShare(token: unknown, expectedHandle: string): VerifiedTopTen | null {
  const handle = normalizeHandle(expectedHandle);
  if (typeof token !== "string" || !token || token.length > TOKEN_MAX_LENGTH || !handle) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0]);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<TopTenClaims>;
    if (claims.v !== TOKEN_VERSION || claims.h !== handle) return null;
    if (!Array.isArray(claims.ids) || !claims.ids.every((id) => typeof id === "string")) return null;
    const ids = cleanIds(claims.ids);
    if (!ids || ids.length !== claims.ids.length) return null;
    if (typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat)) return null;
    return { handle, venueIds: ids, issuedAt: claims.iat };
  } catch {
    return null;
  }
}

/**
 * The page a share link opens. The token is a path segment, not a query, so the
 * file-convention card beside the page receives it in its params.
 */
export function topTenSharePath(handle: string, token: string): string {
  return `/u/${encodeURIComponent(normalizeHandle(handle))}/top-ten/${encodeURIComponent(token)}`;
}
