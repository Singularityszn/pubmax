import "server-only";

// The borough bingo share link (launch review D8). Borough bingo is the
// owner's own card, so nothing reads it in public. When the owner taps
// "Share your card" at 11, 22 or 33 boroughs, the server counts their stamps
// itself, signs the highest mark reached, and hands back a link carrying the
// signature. The page and its card draw that mark and nothing else: never the
// boroughs, never a pub, never a later count. Nobody can make a link for
// somebody else, because only the owner's own read can mint one. The same
// signing pattern as the top-ten share (lib/passportTopTenShare.server.ts).
// The owner's mint lives in lib/boroughBingoMint.server.ts, so the share page
// and its card never import a read of the Authorization header.

import { createHmac, timingSafeEqual } from "node:crypto";

import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { isBoroughBingoMark, type BoroughBingoMark } from "@/lib/boroughBingo";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

const TOKEN_VERSION = 1;
const TOKEN_MAX_LENGTH = 400;

type BingoClaims = { v: typeof TOKEN_VERSION; h: string; m: BoroughBingoMark; iat: number };

export type VerifiedBoroughBingo = { handle: string; mark: BoroughBingoMark; issuedAt: number };

function signature(encoded: string): Buffer {
  return createHmac("sha256", trustedSigningKey())
    .update(`borough-bingo:v${TOKEN_VERSION}:${encoded}`)
    .digest();
}

/** Sign a mark the owner has reached. Throws on anything that is not a mark. */
export function mintBoroughBingoShare(handle: string, mark: BoroughBingoMark, now = Date.now()): string {
  const h = normalizeHandle(handle);
  if (!h || !isBoroughBingoMark(mark)) throw new Error("A borough bingo share needs a handle and a mark.");
  const claims: BingoClaims = { v: TOKEN_VERSION, h, m: mark, iat: now };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded).toString("base64url")}`;
}

/** The signed mark, only when the token is ours and names this handle. */
export function verifyBoroughBingoShare(token: unknown, expectedHandle: string): VerifiedBoroughBingo | null {
  const handle = normalizeHandle(expectedHandle);
  if (typeof token !== "string" || !token || token.length > TOKEN_MAX_LENGTH || !handle) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0]);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<BingoClaims>;
    if (claims.v !== TOKEN_VERSION || claims.h !== handle || !isBoroughBingoMark(claims.m)) return null;
    if (typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat)) return null;
    return { handle, mark: claims.m, issuedAt: claims.iat };
  } catch {
    return null;
  }
}

/** The page a share link opens. The token is a path segment, so the card beside it reads it. */
export function boroughBingoSharePath(handle: string, token: string): string {
  return `/u/${encodeURIComponent(normalizeHandle(handle))}/boroughs/${encodeURIComponent(token)}`;
}

/** The card a share link draws, or null for a token that is not ours or an account that left. */
export async function readBoroughBingoCard(rawHandle: string, token: unknown): Promise<VerifiedBoroughBingo | null> {
  const verified = verifyBoroughBingoShare(token, rawHandle);
  if (!verified) return null;
  try {
    if ((await withdrawnHandles([verified.handle])).has(verified.handle)) return null;
    const profile = await profileStore().getByHandle(verified.handle);
    if (!profile || profile.tombstonedAt) return null;
  } catch {
    return null;
  }
  return verified;
}
