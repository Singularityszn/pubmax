import { createHmac, timingSafeEqual } from "node:crypto";

const PROOF_VERSION = 1;
const PROOF_MAX_LENGTH = 8_000;
const VENUE_ID_MAX = 120;
export const PLAN_GROUNDING_PROOF_TTL_MS = 2 * 60 * 60 * 1_000;

type GroundingPayload = {
  v: typeof PROOF_VERSION;
  venueIds: string[];
  operationDigest: string;
  issuedAt: number;
  expiresAt: number;
};

function groundingSecret(): string {
  return process.env.PLAN_IDEMPOTENCY_SECRET
    ?? process.env.RATE_LIMIT_SALT
    ?? "pubmax-plan-grounding-development-only";
}

function canonicalVenueIds(values: readonly string[]): string[] | null {
  if (values.length < 3 || values.length > 100) return null;
  const ids = values.map((value) => value.trim());
  if (ids.some((value) => !value || value.length > VENUE_ID_MAX)) return null;
  return [...new Set(ids)].sort();
}

function signature(encodedPayload: string): Buffer {
  return createHmac("sha256", groundingSecret())
    .update(`plan-grounding:v${PROOF_VERSION}:${encodedPayload}`)
    .digest();
}

function operationDigest(operationKey: string): string {
  return createHmac("sha256", groundingSecret())
    .update(`plan-grounding-operation:v${PROOF_VERSION}:${operationKey.trim()}`)
    .digest("hex");
}

export type PlanGroundingClaims = GroundingPayload;

/** Mint a signed proof that a set of venues came from server-side generation. */
export function mintPlanGroundingProof(
  venueIds: readonly string[],
  operationKey: string,
  now = Date.now(),
): string {
  const canonical = canonicalVenueIds(venueIds);
  if (!canonical || !operationKey.trim()) throw new Error("A grounding proof needs canonical venues and one create operation.");
  const payload: GroundingPayload = {
    v: PROOF_VERSION,
    venueIds: canonical,
    operationDigest: operationDigest(operationKey),
    issuedAt: now,
    expiresAt: now + PLAN_GROUNDING_PROOF_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded).toString("base64url")}`;
}

/** Verify that exactly three accepted stops were covered by a server-minted proof. */
export function readPlanGroundingClaims(
  proof: unknown,
  acceptedVenueIds: readonly string[],
  operationKey: string,
): PlanGroundingClaims | null {
  if (typeof proof !== "string" || !proof || proof.length > PROOF_MAX_LENGTH) return null;
  if (!operationKey.trim() || acceptedVenueIds.length !== 3 || new Set(acceptedVenueIds).size !== 3) return null;
  const parts = proof.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0]);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<GroundingPayload>;
    if (payload.v !== PROOF_VERSION || !Array.isArray(payload.venueIds)) return null;
    const allowed = canonicalVenueIds(payload.venueIds);
    if (!allowed || allowed.length !== payload.venueIds.length) return null;
    if (payload.operationDigest !== operationDigest(operationKey)) return null;
    if (typeof payload.issuedAt !== "number" || !Number.isSafeInteger(payload.issuedAt)
      || typeof payload.expiresAt !== "number" || !Number.isSafeInteger(payload.expiresAt)) return null;
    if (payload.expiresAt !== payload.issuedAt + PLAN_GROUNDING_PROOF_TTL_MS) return null;
    const allowedSet = new Set(allowed);
    return acceptedVenueIds.every((venueId) => allowedSet.has(venueId))
      ? payload as PlanGroundingClaims
      : null;
  } catch {
    return null;
  }
}

export function verifyPlanGroundingProof(
  proof: unknown,
  acceptedVenueIds: readonly string[],
  operationKey: string,
  now = Date.now(),
): boolean {
  const claims = readPlanGroundingClaims(proof, acceptedVenueIds, operationKey);
  return Boolean(claims && claims.issuedAt <= now && now <= claims.expiresAt);
}

/** Reconstruct the immutable create-time attribution on an idempotent replay. */
export function wasPlanGroundedAtCreation(
  proof: unknown,
  acceptedVenueIds: readonly string[],
  operationKey: string,
  createdAt: string,
): boolean {
  const claims = readPlanGroundingClaims(proof, acceptedVenueIds, operationKey);
  const createdAtMs = Date.parse(createdAt);
  return Boolean(
    claims
    && Number.isFinite(createdAtMs)
    && createdAtMs >= claims.issuedAt - 30_000
    && createdAtMs <= claims.expiresAt,
  );
}
