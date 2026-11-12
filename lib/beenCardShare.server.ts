import "server-only";

// The Been card share link. The same signing pattern as the borough bingo and
// top-ten shares (lib/boroughBingoShare.server.ts): when the owner taps "Share
// your Been card", the server counts their Been list itself, picks their
// cheapest public pint, and signs both with the time. The page and its card
// verify the signature, so nobody can make a link for somebody else or type a
// bigger number into one. The owner's mint lives in lib/beenCardMint.server.ts,
// so this module never imports a read of the Authorization header.

import { createHmac, timingSafeEqual } from "node:crypto";

import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { beenCardDropQualifies, beenCardUnlocked } from "@/lib/beenCard";
import { getPintDropById, type PublicDrop } from "@/lib/pintDropLookup";
import { buildPintReceipt, type PintReceipt } from "@/lib/pintReceipt";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

const TOKEN_VERSION = 1;
const TOKEN_MAX_LENGTH = 600;
const MAX_COUNT = 100_000;
const DROP_ID = /^[A-Za-z0-9:_.-]{1,100}$/;

type BeenCardClaims = { v: typeof TOKEN_VERSION; h: string; n: number; d: string | null; iat: number };

export type VerifiedBeenCard = { handle: string; pubs: number; dropId: string | null; issuedAt: number };

function signature(encoded: string): Buffer {
  return createHmac("sha256", trustedSigningKey()).update(`been-card:v${TOKEN_VERSION}:${encoded}`).digest();
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value <= MAX_COUNT && beenCardUnlocked(value);
}

function validDropId(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && DROP_ID.test(value));
}

/** Sign an unlocked count and the cheapest pint's id. Throws on anything else. */
export function mintBeenCardShare(handle: string, pubs: number, dropId: string | null, now = Date.now()): string {
  const h = normalizeHandle(handle);
  if (!h || !validCount(pubs) || !validDropId(dropId)) {
    throw new Error("A Been card share needs a handle, an unlocked count and a drop id or none.");
  }
  const claims: BeenCardClaims = { v: TOKEN_VERSION, h, n: pubs, d: dropId, iat: now };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded).toString("base64url")}`;
}

/** The signed card, only when the token is ours and names this handle. */
export function verifyBeenCardShare(token: unknown, expectedHandle: string): VerifiedBeenCard | null {
  const handle = normalizeHandle(expectedHandle);
  if (typeof token !== "string" || !token || token.length > TOKEN_MAX_LENGTH || !handle) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0]);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<BeenCardClaims>;
    if (claims.v !== TOKEN_VERSION || claims.h !== handle) return null;
    if (!validCount(claims.n) || !validDropId(claims.d)) return null;
    if (typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat)) return null;
    return { handle, pubs: claims.n, dropId: claims.d, issuedAt: claims.iat };
  } catch {
    return null;
  }
}

/** The page a share link opens. The token is a path segment, so the card beside it reads it. */
export function beenCardSharePath(handle: string, token: string): string {
  return `/u/${encodeURIComponent(normalizeHandle(handle))}/been/${encodeURIComponent(token)}`;
}

export type BeenCard = VerifiedBeenCard & {
  /** The cheapest pint as its receipt, or null when that drop no longer stands. */
  receipt: PintReceipt | null;
};

export type BeenCardReadDeps = {
  accountLeft(handle: string): Promise<boolean>;
  drop(id: string): Promise<PublicDrop | null>;
};

const defaultReadDeps: BeenCardReadDeps = {
  async accountLeft(handle) {
    if ((await withdrawnHandles([handle])).has(handle)) return true;
    const profile = await profileStore().getByHandle(handle);
    return !profile || Boolean(profile.tombstonedAt);
  },
  // No viewer: the drop is read as a stranger would read it.
  drop: (id) => getPintDropById(id),
};

/**
 * The card a share link draws, or null for a token that is not ours or an
 * account that left. The pint is read again: a drop that is no longer the
 * owner's public priced pint leaves the card and the count stays.
 */
export async function readBeenCard(
  rawHandle: string,
  token: unknown,
  deps: BeenCardReadDeps = defaultReadDeps,
): Promise<BeenCard | null> {
  const verified = verifyBeenCardShare(token, rawHandle);
  if (!verified) return null;
  try {
    if (await deps.accountLeft(verified.handle)) return null;
  } catch {
    return null;
  }
  if (!verified.dropId) return { ...verified, receipt: null };
  const drop = await deps.drop(verified.dropId).catch(() => null);
  const receipt = drop && beenCardDropQualifies(drop, verified.handle) ? buildPintReceipt(drop) : null;
  return { ...verified, receipt };
}
