import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST/GET /api/operator-proposals — the capability boundary (only a VERIFIED
// operator of the venue can propose), the account boundary, the per-account rate
// limit, and the moderator accept/decline gate + the admin acceptance seam that
// materialises an accepted proposal into an `operator` FactSource. Supabase pinned
// unconfigured so the memory stores + in-memory limiter back the route.

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const auth = vi.hoisted(() => ({ identity: null as { id: string; email: string | null } | null }));
vi.mock("@/lib/authServer", () => ({
  callerAuthIdentity: () => Promise.resolve(auth.identity),
}));

import { GET, POST } from "@/app/api/operator-proposals/route";
import { __resetOperatorProposals, memoryOperatorProposalStore } from "@/lib/operatorProposalsStore";
import { __resetOperatorFacts, memoryOperatorFactsStore } from "@/lib/operatorFactsStore";
import { __resetVenueOperators, memoryVenueOperatorStore } from "@/lib/venueOperatorsStore";
import { __resetPintDrops } from "@/lib/pintDrops";

function req(body: unknown, ip = "203.0.113.6"): Request {
  return new Request("http://localhost/api/operator-proposals", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function get(qs: string): Request {
  return new Request(`http://localhost/api/operator-proposals${qs}`, { method: "GET" });
}
function withAdmin(r: Request): Request {
  r.headers.set("x-admin-token", "test-admin-secret");
  return r;
}

// Make `accountId` a VERIFIED operator of `venueId` via the store the route reads.
async function verifyOperator(accountId: string, venueId: string): Promise<void> {
  const dto = await memoryVenueOperatorStore.claim({
    accountId,
    venueId,
    evidenceKind: "email-domain",
    evidenceNote: "domain",
  });
  await memoryVenueOperatorStore.setState(dto.id, "verified");
}

const correction = { venueId: "v1", type: "correction", payload: { field: "hours", body: "Open till 1am" } };

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.ADMIN_TOKEN = "test-admin-secret";
  auth.identity = null;
  __resetOperatorProposals();
  __resetOperatorFacts();
  __resetVenueOperators();
  __resetPintDrops();
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/operator-proposals (create)", () => {
  it("401s an anonymous caller", async () => {
    expect((await POST(req(correction))).status).toBe(401);
  });

  it("403s a signed-in caller who is NOT a verified operator", async () => {
    auth.identity = { id: "acct-1", email: null };
    const res = await POST(req(correction));
    expect(res.status).toBe(403);
    const data = (await res.json()) as { code: string; error: string };
    expect(data.code).toBe("NOT_VERIFIED_OPERATOR");
    expect(data.error).toBe(
      "Only an approved operator of this venue can propose an update.",
    );
    // Nothing was written.
    expect(await memoryOperatorProposalStore.listForReview("pending")).toHaveLength(0);
  });

  it("201s for a verified operator and queues a pending proposal", async () => {
    auth.identity = { id: "acct-1", email: null };
    await verifyOperator("acct-1", "v1");
    const res = await POST(req(correction));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { proposal: { status: string; type: string } };
    expect(data.proposal.status).toBe("pending");
    expect(await memoryOperatorProposalStore.listForReview("pending")).toHaveLength(1);
  });

  it("400s an incomplete payload for the type", async () => {
    auth.identity = { id: "acct-1", email: null };
    await verifyOperator("acct-1", "v1");
    // correction requires field + body; omit body.
    const res = await POST(req({ venueId: "v1", type: "correction", payload: { field: "hours" } }));
    expect(res.status).toBe(400);
  });

  it("a verified operator of ONE venue cannot propose for ANOTHER", async () => {
    auth.identity = { id: "acct-1", email: null };
    await verifyOperator("acct-1", "v1");
    const res = await POST(req({ venueId: "v2", type: "response", payload: { body: "hello" } }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/operator-proposals (moderator accept/decline)", () => {
  it("403s accept without the admin token", async () => {
    expect((await POST(req({ action: "accept", id: "x" }))).status).toBe(403);
  });

  it("accepts a proposal and materialises an operator FactSource", async () => {
    auth.identity = { id: "acct-1", email: null };
    await verifyOperator("acct-1", "v1");
    const created = await POST(req(correction));
    const { proposal } = (await created.json()) as { proposal: { id: string } };

    const res = await POST(withAdmin(req({ action: "accept", id: proposal.id })));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      materialized: { authority: string; value: string; reviewed: boolean };
    };
    expect(data.ok).toBe(true);
    // The bridge: authority `operator` (rank 0), the corrected value, reviewed.
    expect(data.materialized.authority).toBe("operator");
    expect(data.materialized.value).toBe("Open till 1am");
    expect(data.materialized.reviewed).toBe(true);
    // Now in the venue's accepted set, out of pending.
    expect(await memoryOperatorProposalStore.listAcceptedForVenue("v1")).toHaveLength(1);
    expect(await memoryOperatorProposalStore.listForReview("pending")).toHaveLength(0);
  });

  it("declines a proposal (nothing materialises)", async () => {
    auth.identity = { id: "acct-1", email: null };
    await verifyOperator("acct-1", "v1");
    const created = await POST(req(correction));
    const { proposal } = (await created.json()) as { proposal: { id: string } };
    const res = await POST(withAdmin(req({ action: "decline", id: proposal.id })));
    expect(res.status).toBe(200);
    expect(await memoryOperatorProposalStore.listAcceptedForVenue("v1")).toHaveLength(0);
  });

  it("lets a decline undo an accept, but refuses a stale accept or a second decline", async () => {
    auth.identity = { id: "acct-1", email: null };
    await verifyOperator("acct-1", "v1");
    const created = await POST(req(correction));
    const { proposal } = (await created.json()) as { proposal: { id: string } };
    expect((await POST(withAdmin(req({ action: "accept", id: proposal.id })))).status).toBe(200);
    // A second accept from a stale tab must not withdraw the published fact.
    expect((await POST(withAdmin(req({ action: "accept", id: proposal.id })))).status).toBe(409);
    expect(await memoryOperatorProposalStore.listAcceptedForVenue("v1")).toHaveLength(1);
    expect((await memoryOperatorFactsStore.listPublishedForVenue("v1")).facts).toMatchObject([
      { proposalId: proposal.id, body: "Open till 1am" },
    ]);
    // The moderator's undo still works.
    expect((await POST(withAdmin(req({ action: "decline", id: proposal.id })))).status).toBe(200);
    expect(await memoryOperatorProposalStore.listAcceptedForVenue("v1")).toHaveLength(0);
    expect((await memoryOperatorFactsStore.listPublishedForVenue("v1")).facts).toEqual([]);
    // A stale tab cannot accept the declined proposal back, or decline it twice.
    expect((await POST(withAdmin(req({ action: "accept", id: proposal.id })))).status).toBe(409);
    expect((await POST(withAdmin(req({ action: "decline", id: proposal.id })))).status).toBe(409);
    expect(await memoryOperatorProposalStore.listAcceptedForVenue("v1")).toHaveLength(0);
  });

  it.each(["conflict", "failed read", "failure before winner", "failure after winner"])(
    "preserves the winning publication with an overlapping %s",
    async (outcome) => {
      const proposal = await memoryOperatorProposalStore.create({
        ...correction, type: "correction", accountId: "acct-1",
      });
      const decide = memoryOperatorProposalStore.decide;
      let entered!: () => void;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => { entered = resolve; });
      const winnerDone = new Promise<void>((resolve) => { release = resolve; });
      vi.spyOn(memoryOperatorProposalStore, "decide").mockImplementationOnce(async (...args) => {
        entered();
        if (outcome === "failure before winner") throw new Error("write failed");
        await winnerDone;
        if (outcome === "failure after winner") throw new Error("write failed");
        return decide(...args);
      });
      const loser = POST(withAdmin(req({ action: "accept", id: proposal.id })));
      await waiting;
      const winner = await POST(withAdmin(req({ action: "accept", id: proposal.id })));
      if (outcome === "failed read") {
        vi.spyOn(memoryOperatorProposalStore, "listForReview").mockResolvedValue([]);
      }
      release();
      expect(winner.status).toBe(200);
      expect((await loser).status).toBe(outcome.startsWith("failure") ? 503 : 409);
      expect(await memoryOperatorProposalStore.listAcceptedForVenue("v1")).toHaveLength(1);
      expect((await memoryOperatorFactsStore.listPublishedForVenue("v1")).facts).toMatchObject([
        { proposalId: proposal.id, body: "Open till 1am" },
      ]);
    },
  );

  it.each(["accept", "decline"])("keeps a decline final when %s enters first", async (first) => {
    const proposal = await memoryOperatorProposalStore.create({
      ...correction, type: "correction", accountId: "acct-1",
    });
    const decide = memoryOperatorProposalStore.decide;
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const secondDone = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(memoryOperatorProposalStore, "decide").mockImplementationOnce(async (...args) => {
      entered();
      await secondDone;
      return decide(...args);
    });
    const delayed = POST(withAdmin(req({ action: first, id: proposal.id })));
    await waiting;
    const second = await POST(withAdmin(req({ action: first === "accept" ? "decline" : "accept", id: proposal.id })));
    release();
    expect(second.status).toBe(200);
    expect((await delayed).status).toBe(first === "accept" ? 409 : 200);
    expect(await memoryOperatorProposalStore.listForReview("declined")).toMatchObject([{ id: proposal.id }]);
    expect((await memoryOperatorFactsStore.listPublishedForVenue("v1")).facts).toEqual([]);
  });

  it("404s accept against an unknown id", async () => {
    expect((await POST(withAdmin(req({ action: "accept", id: "nope" })))).status).toBe(404);
  });
});

describe("GET /api/operator-proposals", () => {
  it("403s the review queue without the admin token", async () => {
    expect((await GET(get("?status=pending"))).status).toBe(403);
  });

  it("400s without a status", async () => {
    expect((await GET(withAdmin(get("")))).status).toBe(400);
  });

  it("serves the pending queue with the admin token", async () => {
    auth.identity = { id: "acct-1", email: null };
    await verifyOperator("acct-1", "v1");
    await POST(req(correction));
    const res = await GET(withAdmin(get("?status=pending")));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { proposals: unknown[] };
    expect(data.proposals).toHaveLength(1);
  });
});
