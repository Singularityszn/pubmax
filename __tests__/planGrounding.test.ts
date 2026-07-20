import { describe, expect, it } from "vitest";

import { mintPlanGroundingProof, verifyPlanGroundingProof } from "@/lib/planGrounding.server";

describe("server-owned Plan grounding proof", () => {
  const candidates = ["venue-a", "venue-b", "venue-c", "venue-d"];

  it("covers exactly three accepted venues from the generated candidate set", () => {
    const proof = mintPlanGroundingProof(candidates);

    expect(verifyPlanGroundingProof(proof, ["venue-a", "venue-b", "venue-c"])).toBe(true);
    expect(verifyPlanGroundingProof(proof, ["venue-a", "venue-b", "venue-d"])).toBe(true);
  });

  it("fails closed for edits, client forgery, duplicates, and malformed proofs", () => {
    const proof = mintPlanGroundingProof(candidates);
    const [payload, signature] = proof.split(".");

    expect(verifyPlanGroundingProof(proof, ["venue-a", "venue-b", "venue-x"])).toBe(false);
    expect(verifyPlanGroundingProof(proof, ["venue-a", "venue-a", "venue-b"])).toBe(false);
    expect(verifyPlanGroundingProof(`${payload}.${signature}x`, ["venue-a", "venue-b", "venue-c"])).toBe(false);
    expect(verifyPlanGroundingProof(true, ["venue-a", "venue-b", "venue-c"])).toBe(false);
  });
});
