import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { PlanState } from "@/lib/plan";
import { resolvePlanProjection } from "@/lib/planPrivacyBoundary.server";
import { planMemberIdentityResult } from "@/lib/planStore";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "member-capability-token";

function planState(): PlanState {
  return {
    plan: {
      id: PLAN_ID,
      title: "Private stag route",
      startTime: "2026-07-24T19:00:00.000Z",
      createdAt: "2026-07-24T12:00:00.000Z",
      status: "ready",
    },
    stops: [
      { venueId: "venue-the-dove", venueName: "The Dove", position: 0 },
      { venueId: "venue-the-anchor", venueName: "The Anchor", position: 1 },
    ],
    crew: [{ id: "c1", name: "Dave" }] as PlanState["crew"],
    context: null,
    actions: [],
    ending: null,
  };
}

function request(withCapability: boolean): Request {
  return new Request(`http://localhost/api/plans/${PLAN_ID}`, {
    headers: withCapability ? { authorization: `Bearer ${TOKEN}` } : {},
  });
}

type Identity = Awaited<ReturnType<typeof planMemberIdentityResult>>;
const lookupReturning = (value: Identity): typeof planMemberIdentityResult =>
  (async () => value) as unknown as typeof planMemberIdentityResult;
const identity = (role: "host" | "guest"): Identity =>
  ({ ok: true, identity: { memberId: "c1", role, collaborationAuthorized: role === "host" } }) as Identity;

async function resolve(opts: {
  cap: boolean;
  lookup?: typeof planMemberIdentityResult;
}) {
  return resolvePlanProjection({
    request: request(opts.cap),
    planId: PLAN_ID,
    state: planState(),
    identityLookup: opts.lookup,
  });
}

describe("resolvePlanProjection \u2014 a capability is the whole question", () => {
  it("a valid HOST capability returns member state, with no flag to switch it off", async () => {
    const p = await resolve({ cap: true, lookup: lookupReturning(identity("host")) });
    expect(p.visibility).toBe("member");
    if (p.visibility === "member") expect(p.state.stops).toHaveLength(2);
  });

  it("a joined GUEST's capability returns member state", async () => {
    const p = await resolve({ cap: true, lookup: lookupReturning(identity("guest")) });
    expect(p.visibility).toBe("member");
    if (p.visibility === "member") expect(p.state.stops).toHaveLength(2);
  });

  it("no capability returns preview", async () => {
    const p = await resolve({ cap: false, lookup: lookupReturning(identity("host")) });
    expect(p.visibility).toBe("preview");
  });

  it("a missing/expired/revoked/wrong-plan identity returns preview", async () => {
    const p = await resolve({ cap: true, lookup: lookupReturning({ ok: true, identity: null } as Identity) });
    expect(p.visibility).toBe("preview");
  });

  it("a store error returns preview (fail closed)", async () => {
    const p = await resolve({ cap: true, lookup: lookupReturning({ ok: false, error: "error" } as Identity) });
    expect(p.visibility).toBe("preview");
  });

  it("a lookup that throws returns preview (fail closed)", async () => {
    const throwing = (async () => { throw new Error("db down"); }) as unknown as typeof planMemberIdentityResult;
    const p = await resolve({ cap: true, lookup: throwing });
    expect(p.visibility).toBe("preview");
  });

  it("a preview projection serializes with no venue ids or names", async () => {
    const p = await resolve({ cap: false, lookup: lookupReturning(identity("host")) });
    const raw = JSON.stringify(p);
    expect(raw).not.toContain("venue-the-dove");
    expect(raw).not.toContain("The Dove");
    expect(raw).not.toContain("Private stag route");
  });

  // D01 regression (core-loop battle test, 5 Sep 2026): the member projection
  // sat behind PUBMAX_FRIEND_MEMBER_REHYDRATION_V2, so a deployment without
  // that variable answered the preview to a host reading their own plan. The
  // environment may no longer decide this.
  it("reads no environment variable, so a host is a host on every deployment", async () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/planPrivacyBoundary.server.ts"),
      "utf8",
    );
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("FRIEND_MEMBER_REHYDRATION");

    const withFlagUnset = { ...process.env };
    delete withFlagUnset.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2;
    const previous = process.env;
    process.env = withFlagUnset as NodeJS.ProcessEnv;
    try {
      const p = await resolve({ cap: true, lookup: lookupReturning(identity("host")) });
      expect(p.visibility).toBe("member");
    } finally {
      process.env = previous;
    }
  });
});
