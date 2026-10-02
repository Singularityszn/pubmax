import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceMetering";
import { isPubPalConversationId } from "@/lib/pubPalConversationId";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

const TOKEN_VERSION = 1;
const TOKEN_MAX_LENGTH = 1_000;
const OWNER_ID_MAX_LENGTH = 128;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

// Provider grants allow initiation for 15 minutes. An established session may
// then use the full live cap. This proves issuance/ownership, not SDK liveness
// or immediate revocation after End. It retains no transcript or audio.
// https://elevenlabs.io/docs/eleven-agents/customization/authentication
export const PUB_PAL_VOICE_OWNER_PROOF_TTL_MS =
  (900 + PAL_VOICE_MAX_SESSION_SECONDS) * 1_000;

type VoiceOwnerProofClaims = {
  v: typeof TOKEN_VERSION;
  ownerId: string;
  conversationId: string;
  issuedAt: number;
  expiresAt: number;
};

export type VerifiedPubPalVoiceOwnerProof = Omit<VoiceOwnerProofClaims, "v">;

function isOwnerId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= OWNER_ID_MAX_LENGTH && value.trim() === value;
}

function encodeClaims(claims: VoiceOwnerProofClaims): string {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}

function signature(encoded: string): Buffer {
  return createHmac("sha256", trustedSigningKey())
    .update(`pub-pal-voice-owner:v${TOKEN_VERSION}:${encoded}`)
    .digest();
}

function canonicalBase64url(value: string): Buffer | null {
  if (!BASE64URL_RE.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  if (!decoded.length || decoded.toString("base64url") !== value) return null;
  return decoded;
}

function exactClaims(value: unknown): VoiceOwnerProofClaims | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== 5 ||
    !["v", "ownerId", "conversationId", "issuedAt", "expiresAt"].every((key) => keys.includes(key)) ||
    candidate.v !== TOKEN_VERSION ||
    !isOwnerId(candidate.ownerId) ||
    typeof candidate.conversationId !== "string" ||
    !isPubPalConversationId(candidate.conversationId) ||
    typeof candidate.issuedAt !== "number" ||
    !Number.isSafeInteger(candidate.issuedAt) ||
    candidate.issuedAt < 0 ||
    typeof candidate.expiresAt !== "number" ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    candidate.expiresAt !== candidate.issuedAt + PUB_PAL_VOICE_OWNER_PROOF_TTL_MS
  ) return null;

  return {
    v: TOKEN_VERSION,
    ownerId: candidate.ownerId,
    conversationId: candidate.conversationId,
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt,
  };
}

/** Call only after the provider conversation has been bound to this verified owner. */
export function mintPubPalVoiceOwnerProof(
  ownerId: string,
  conversationId: string,
  now = Date.now(),
): string {
  if (
    !isOwnerId(ownerId) ||
    !isPubPalConversationId(conversationId) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(now + PUB_PAL_VOICE_OWNER_PROOF_TTL_MS)
  ) throw new Error("Pub Pal voice proof needs a verified owner and provider conversation.");

  const encoded = encodeClaims({
    v: TOKEN_VERSION,
    ownerId,
    conversationId,
    issuedAt: now,
    expiresAt: now + PUB_PAL_VOICE_OWNER_PROOF_TTL_MS,
  });
  const proof = `${encoded}.${signature(encoded).toString("base64url")}`;
  if (proof.length > TOKEN_MAX_LENGTH) {
    throw new Error("Pub Pal voice proof exceeds its supported size.");
  }
  return proof;
}

export function verifyPubPalVoiceOwnerProof(
  proof: unknown,
  expectedOwnerId: string,
  expectedConversationId: string,
  now = Date.now(),
): VerifiedPubPalVoiceOwnerProof | null {
  if (
    typeof proof !== "string" || !proof || proof.length > TOKEN_MAX_LENGTH ||
    !isOwnerId(expectedOwnerId) || !isPubPalConversationId(expectedConversationId) ||
    !Number.isSafeInteger(now) || now < 0
  ) return null;
  const parts = proof.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  try {
    const payload = canonicalBase64url(parts[0]);
    const supplied = canonicalBase64url(parts[1]);
    if (!payload || !supplied || supplied.length !== 32) return null;
    if (!timingSafeEqual(supplied, signature(parts[0]))) return null;
    const claims = exactClaims(JSON.parse(payload.toString("utf8")));
    if (
      !claims || encodeClaims(claims) !== parts[0] ||
      claims.ownerId !== expectedOwnerId || claims.conversationId !== expectedConversationId ||
      claims.issuedAt > now || now >= claims.expiresAt
    ) return null;
    return {
      ownerId: claims.ownerId,
      conversationId: claims.conversationId,
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
    };
  } catch {
    return null;
  }
}
