import { describe, expect, it, vi } from "vitest";

import {
  isClassicPlanInviteToken,
  planCrewSharePath,
  planInviteSharePath,
  planInviteShareUrl,
} from "@/lib/planCrewInviteUrl";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const CLASSIC = "a".repeat(32);
const COLLAB = "b".repeat(64);

describe("planCrewSharePath", () => {
  it("attaches classic #invite= so WhatsApp guests can join", () => {
    expect(planCrewSharePath(PLAN_ID, CLASSIC)).toBe(
      `/plan/${PLAN_ID}#invite=${CLASSIC}`,
    );
  });

  it("keeps ?vibe= before the invite hash", () => {
    expect(planCrewSharePath(PLAN_ID, CLASSIC, "cosy")).toBe(
      `/plan/${PLAN_ID}?vibe=cosy#invite=${CLASSIC}`,
    );
  });

  it("refuses to mint a join URL without a classic invite token", () => {
    expect(planCrewSharePath(PLAN_ID, COLLAB)).toBe(`/plan/${PLAN_ID}`);
    expect(planCrewSharePath(PLAN_ID, "")).toBe(`/plan/${PLAN_ID}`);
  });
});

// ONE LINK (launch review 3.5): every host share sends the public invite page,
// with a host, never the plan id.
describe("planInviteSharePath and planInviteShareUrl", () => {
  it("shares the /invite page for a classic token", () => {
    expect(planInviteSharePath(CLASSIC)).toBe(`/invite/${CLASSIC}`);
    expect(planInviteSharePath(CLASSIC.toUpperCase())).toBe(`/invite/${CLASSIC}`);
  });

  it("refuses anything that is not a classic token", () => {
    expect(planInviteSharePath(COLLAB)).toBeNull();
    expect(planInviteSharePath(PLAN_ID)).toBeNull();
    expect(planInviteSharePath(null)).toBeNull();
  });

  it("puts the current origin on the link outside production", () => {
    expect(planInviteShareUrl(CLASSIC, `http://localhost:3000/plan/${PLAN_ID}`)).toBe(
      `http://localhost:3000/invite/${CLASSIC}`,
    );
    expect(planInviteShareUrl(COLLAB, "http://localhost:3000/")).toBeNull();
  });

  it("carries the canonical site in production, whatever host the page is on", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pubmaxxing.com");
    try {
      expect(planInviteShareUrl(CLASSIC, `https://preview.example.com/plan/${PLAN_ID}`)).toBe(
        `https://pubmaxxing.com/invite/${CLASSIC}`,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("isClassicPlanInviteToken", () => {
  it("accepts 32-hex classic tokens and rejects collaboration tokens", () => {
    expect(isClassicPlanInviteToken(CLASSIC)).toBe(true);
    expect(isClassicPlanInviteToken(CLASSIC.toUpperCase())).toBe(true);
    expect(isClassicPlanInviteToken(COLLAB)).toBe(false);
    expect(isClassicPlanInviteToken(PLAN_ID)).toBe(false);
  });
});
