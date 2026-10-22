import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceMetering";
import {
  mintPubPalVoiceOwnerProof,
  PUB_PAL_VOICE_OWNER_PROOF_TTL_MS,
  verifyPubPalVoiceOwnerProof,
} from "@/lib/pubPalVoiceOwnerProof.server";

const TEST_SECRET = "test-only-pub-pal-voice-owner-proof-secret";
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "conv_voiceOwner01";
const START = Date.parse("2026-10-02T12:00:00.000Z");
const DOMAIN = "pub-pal-voice-owner:v1";

function signEncoded(encoded: string, domain = DOMAIN): string {
  const signature = createHmac("sha256", TEST_SECRET)
    .update(`${domain}:${encoded}`)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function signedClaims(patch: Record<string, unknown> = {}): string {
  return signEncoded(Buffer.from(JSON.stringify({
    v: 1,
    ownerId: OWNER,
    conversationId: CONVERSATION,
    issuedAt: START,
    expiresAt: START + PUB_PAL_VOICE_OWNER_PROOF_TTL_MS,
    ...patch,
  }), "utf8").toString("base64url"));
}

describe("Pub Pal voice owner proof", () => {
  beforeEach(() => {
    vi.stubEnv("PLAN_IDEMPOTENCY_SECRET", TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("covers the documented initiation window plus the unchanged live cap", () => {
    expect(PAL_VOICE_MAX_SESSION_SECONDS).toBe(180);
    expect(PUB_PAL_VOICE_OWNER_PROOF_TTL_MS).toBe((900 + 180) * 1_000);
    const proof = mintPubPalVoiceOwnerProof(OWNER, CONVERSATION, START);

    expect(verifyPubPalVoiceOwnerProof(
      proof, OWNER, CONVERSATION, START + PUB_PAL_VOICE_OWNER_PROOF_TTL_MS - 1,
    )).toEqual({
      ownerId: OWNER,
      conversationId: CONVERSATION,
      issuedAt: START,
      expiresAt: START + PUB_PAL_VOICE_OWNER_PROOF_TTL_MS,
    });
    expect(verifyPubPalVoiceOwnerProof(
      proof, OWNER, CONVERSATION, START + PUB_PAL_VOICE_OWNER_PROOF_TTL_MS,
    )).toBeNull();
  });

  it("requires the exact authenticated owner and provider conversation", () => {
    const proof = mintPubPalVoiceOwnerProof(OWNER, CONVERSATION, START);

    expect(verifyPubPalVoiceOwnerProof(proof, OTHER_OWNER, CONVERSATION, START)).toBeNull();
    expect(verifyPubPalVoiceOwnerProof(proof, OWNER, "conv_voiceOwner02", START)).toBeNull();
    expect(verifyPubPalVoiceOwnerProof(proof, OWNER, "unissued-id", START)).toBeNull();
    expect(verifyPubPalVoiceOwnerProof(proof, "", CONVERSATION, START)).toBeNull();
  });

  it("rejects signature tampering and tokens signed for another domain", () => {
    const proof = mintPubPalVoiceOwnerProof(OWNER, CONVERSATION, START);
    const [encoded, signature] = proof.split(".") as [string, string];
    const tampered = `${encoded}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;

    expect(verifyPubPalVoiceOwnerProof(tampered, OWNER, CONVERSATION, START)).toBeNull();
    expect(verifyPubPalVoiceOwnerProof(
      signEncoded(encoded, "referral-signup-proof:v1"), OWNER, CONVERSATION, START,
    )).toBeNull();
  });

  it.each([
    { v: 2 },
    { ownerId: OTHER_OWNER },
    { ownerId: "x".repeat(129) },
    { conversationId: "conv_voiceOwner02" },
    { conversationId: "unissued-id" },
    { issuedAt: START + 1, expiresAt: START + 1 + (900 + 180) * 1_000 },
    { issuedAt: -1 },
    { issuedAt: START + 0.5 },
    { expiresAt: START + (900 + 180) * 1_000 + 1 },
    { expiresAt: String(START + (900 + 180) * 1_000) },
    { expiresAt: undefined },
    { extra: "not-part-of-contract" },
  ])("rejects signed invalid claims %j", (patch) => {
    expect(verifyPubPalVoiceOwnerProof(signedClaims(patch), OWNER, CONVERSATION, START)).toBeNull();
  });

  it("rejects noncanonical encoding, key order and JSON payloads", () => {
    const proof = mintPubPalVoiceOwnerProof(OWNER, CONVERSATION, START);
    const [encoded, signature] = proof.split(".") as [string, string];
    const reordered = Buffer.from(JSON.stringify({
      ownerId: OWNER,
      v: 1,
      conversationId: CONVERSATION,
      issuedAt: START,
      expiresAt: START + PUB_PAL_VOICE_OWNER_PROOF_TTL_MS,
    })).toString("base64url");
    const duplicate = Buffer.from(
      Buffer.from(encoded, "base64url").toString("utf8").replace('{"v":1,', '{"v":1,"v":1,'),
    ).toString("base64url");

    expect(verifyPubPalVoiceOwnerProof(signEncoded(`${encoded}=`), OWNER, CONVERSATION, START)).toBeNull();
    expect(verifyPubPalVoiceOwnerProof(`${encoded}.${signature}=`, OWNER, CONVERSATION, START)).toBeNull();
    expect(verifyPubPalVoiceOwnerProof(signEncoded(reordered), OWNER, CONVERSATION, START)).toBeNull();
    expect(verifyPubPalVoiceOwnerProof(signEncoded(duplicate), OWNER, CONVERSATION, START)).toBeNull();
    expect(verifyPubPalVoiceOwnerProof(signEncoded(Buffer.from("null").toString("base64url")), OWNER, CONVERSATION, START)).toBeNull();
    expect(verifyPubPalVoiceOwnerProof(signEncoded(Buffer.from("[]").toString("base64url")), OWNER, CONVERSATION, START)).toBeNull();
    expect(verifyPubPalVoiceOwnerProof(signEncoded(Buffer.from("not-json").toString("base64url")), OWNER, CONVERSATION, START)).toBeNull();
  });

  it.each([null, {}, "", "x".repeat(1_001), "a.b.c", "a.", ".a", "a.%"])(
    "rejects a malformed or oversized token %j",
    (proof) => {
      expect(verifyPubPalVoiceOwnerProof(proof, OWNER, CONVERSATION, START)).toBeNull();
    },
  );

  it.each([NaN, Infinity, -1, START + 0.5])("rejects invalid verifier time %s", (now) => {
    expect(verifyPubPalVoiceOwnerProof(signedClaims(), OWNER, CONVERSATION, now)).toBeNull();
  });

  it("refuses to mint invalid identities or overflowing time", () => {
    expect(() => mintPubPalVoiceOwnerProof("", CONVERSATION, START)).toThrow();
    expect(() => mintPubPalVoiceOwnerProof(OWNER, "unissued-id", START)).toThrow();
    expect(() => mintPubPalVoiceOwnerProof(OWNER, CONVERSATION, Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => mintPubPalVoiceOwnerProof(OWNER, CONVERSATION, -1)).toThrow();
  });

  it("refuses to mint identities whose encoding exceeds the verifier bound", () => {
    expect(() => mintPubPalVoiceOwnerProof("\u0000".repeat(128), CONVERSATION, START)).toThrow();
  });

  it("round-trips the maximum supported ordinary owner id", () => {
    const ownerId = "x".repeat(128);
    const proof = mintPubPalVoiceOwnerProof(ownerId, CONVERSATION, START);
    expect(verifyPubPalVoiceOwnerProof(proof, ownerId, CONVERSATION, START)?.ownerId).toBe(ownerId);
  });

  it("fails closed with no trusted signing secret in production", () => {
    const proof = mintPubPalVoiceOwnerProof(OWNER, CONVERSATION, START);
    vi.stubEnv("PLAN_IDEMPOTENCY_SECRET", "");
    vi.stubEnv("RATE_LIMIT_SALT", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => mintPubPalVoiceOwnerProof(OWNER, CONVERSATION, START)).toThrow();
    expect(verifyPubPalVoiceOwnerProof(proof, OWNER, CONVERSATION, START)).toBeNull();
  });
});
