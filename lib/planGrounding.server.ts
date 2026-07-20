import { createHmac, timingSafeEqual } from "node:crypto";

const PROOF_VERSION = 1;
const PROOF_MAX_LENGTH = 8_000;
const VENUE_ID_MAX = 120;

type GroundingPayload = {
  v: typeof PROOF_VERSION;
  venueIds: string[];
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

/** Mint a signed proof that a set of venues came from server-side generation. */
export function mintPlanGroundingProof(venueIds: readonly string[]): string {
  const canonical = canonicalVenueIds(venueIds);
  if (!canonical) throw new Error("A grounding proof needs at least three canonical venues.");
  const payload: GroundingPayload = { v: PROOF_VERSION, venueIds: canonical };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded).toString("base64url")}`;
}

/** Verify that exactly three accepted stops were covered by a server-minted proof. */
export function verifyPlanGroundingProof(proof: unknown, acceptedVenueIds: readonly string[]): boolean {
  if (typeof proof !== "string" || !proof || proof.length > PROOF_MAX_LENGTH) return false;
  if (acceptedVenueIds.length !== 3 || new Set(acceptedVenueIds).size !== 3) return false;
  const parts = proof.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  try {
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0]);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<GroundingPayload>;
    if (payload.v !== PROOF_VERSION || !Array.isArray(payload.venueIds)) return false;
    const allowed = canonicalVenueIds(payload.venueIds);
    if (!allowed || allowed.length !== payload.venueIds.length) return false;
    const allowedSet = new Set(allowed);
    return acceptedVenueIds.every((venueId) => allowedSet.has(venueId));
  } catch {
    return false;
  }
}
