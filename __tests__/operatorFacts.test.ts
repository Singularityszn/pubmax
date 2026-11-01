import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Operator facts (launch plan 1 Nov 2026, section 7 item 1): the pure reading
// rules, the memory store, and the two routes end to end. An ACCEPTED proposal
// persists as a published fact the venue sheet reads; a pending or declined one
// never shows; a decline after an accept withdraws it; the public read carries
// no account id. Supabase is pinned unconfigured so the memory stores answer.

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const auth = vi.hoisted(() => ({ identity: null as { id: string; email: string | null } | null }));
vi.mock("@/lib/authServer", () => ({
  callerAuthIdentity: () => Promise.resolve(auth.identity),
}));

import { GET as getFacts } from "@/app/api/operator-facts/route";
import { POST } from "@/app/api/operator-proposals/route";
import {
  OPERATOR_FACT_KIND_LABEL,
  operatorFactAddedLine,
  operatorFactFromProposal,
  operatorFactOnDay,
  operatorServiceDay,
  toPublicOperatorFact,
  tonightOperatorFacts,
  venueSheetOperatorFacts,
  type OperatorFact,
} from "@/lib/operatorFacts";
import { __resetOperatorFacts, memoryOperatorFactsStore } from "@/lib/operatorFactsStore";
import { validateOperatorProposal, type OperatorProposal } from "@/lib/operatorProposals";
import { __resetOperatorProposals, memoryOperatorProposalStore } from "@/lib/operatorProposalsStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetVenueOperators, memoryVenueOperatorStore } from "@/lib/venueOperatorsStore";

// 19:00 London on Sunday 1 November 2026 (GMT).
const NOW = Date.parse("2026-11-01T19:00:00.000Z");
const TONIGHT = "2026-11-01";

function fact(over: Partial<OperatorFact> = {}): OperatorFact {
  return {
    id: "fact-1",
    proposalId: "proposal-1",
    venueId: "venue-synthetic",
    accountId: "acct-secret",
    kind: "event",
    title: "Quiz night",
    body: null,
    field: null,
    when: "8pm",
    onDate: null,
    publishedAt: "2026-10-30T12:00:00.000Z",
    withdrawnAt: null,
    ...over,
  };
}

function proposal(over: Partial<OperatorProposal> = {}): OperatorProposal {
  return {
    id: "proposal-1",
    venueId: "venue-synthetic",
    accountId: "acct-1",
    type: "event",
    payload: { title: "Quiz night", startsAt: "Thursdays, 8pm" },
    status: "pending",
    createdAt: "2026-10-30T12:00:00.000Z",
    ...over,
  };
}

describe("the proposal's one-night date", () => {
  it("keeps a real date on an event or an offer and refuses one that names no day", () => {
    const event = validateOperatorProposal(
      { venueId: "v1", type: "event", payload: { title: "Quiz", startsAt: "8pm", onDate: "2026-11-05" } },
      "acct-1",
    );
    expect(event.ok && event.fields.payload.onDate).toBe("2026-11-05");
    const bad = validateOperatorProposal(
      { venueId: "v1", type: "offer", payload: { title: "Two for one", body: "Ales", onDate: "2026-02-30" } },
      "acct-1",
    );
    expect(bad.ok).toBe(false);
  });

  it("drops a date sent with a correction or a response", () => {
    const correction = validateOperatorProposal(
      { venueId: "v1", type: "correction", payload: { field: "hours", body: "Till 1am", onDate: "2026-11-05" } },
      "acct-1",
    );
    expect(correction.ok && correction.fields.payload.onDate).toBeUndefined();
  });
});

describe("operator fact reading rules", () => {
  it("publishes a proposal's words and nothing it did not say", () => {
    const published = operatorFactFromProposal(
      proposal({ payload: { title: "Quiz night", startsAt: "Thursdays, 8pm", onDate: "2026-11-05", field: "x" } }),
      { id: "fact-9", publishedAt: "2026-11-01T10:00:00.000Z" },
    );
    expect(published).toMatchObject({
      id: "fact-9",
      proposalId: "proposal-1",
      kind: "event",
      title: "Quiz night",
      when: "Thursdays, 8pm",
      onDate: "2026-11-05",
      field: null,
      withdrawnAt: null,
    });
    const reply = operatorFactFromProposal(
      proposal({ type: "response", payload: { body: "Thanks, fixed the tap.", onDate: "2026-11-05" } }),
      { id: "fact-10", publishedAt: "2026-11-01T10:00:00.000Z" },
    );
    expect(reply.onDate).toBeNull();
    expect(reply.when).toBeNull();
  });

  it("projects no account id and no proposal id to a reader", () => {
    const projected = toPublicOperatorFact(fact());
    expect(projected).not.toHaveProperty("accountId");
    expect(projected).not.toHaveProperty("proposalId");
    expect(JSON.stringify(projected)).not.toContain("acct-secret");
  });

  it("shows the venue sheet published facts only, and a dated one until its night is over", () => {
    const shown = venueSheetOperatorFacts(
      [
        fact({ id: "standing", onDate: null, publishedAt: "2026-10-01T10:00:00.000Z" }),
        fact({ id: "tonight", onDate: TONIGHT, publishedAt: "2026-10-31T10:00:00.000Z" }),
        fact({ id: "next-week", onDate: "2026-11-08", publishedAt: "2026-10-30T10:00:00.000Z" }),
        fact({ id: "last-week", onDate: "2026-10-25" }),
        fact({ id: "withdrawn", withdrawnAt: "2026-10-31T12:00:00.000Z" }),
      ],
      NOW,
    );
    expect(shown.map((f) => f.id)).toEqual(["tonight", "next-week", "standing"]);
  });

  it("gives Tonight only events and offers dated for this London service day", () => {
    const rows = [
      fact({ id: "event-tonight", onDate: TONIGHT }),
      fact({ id: "offer-tonight", kind: "offer", onDate: TONIGHT }),
      fact({ id: "event-undated", onDate: null }),
      fact({ id: "event-tomorrow", onDate: "2026-11-02" }),
      fact({ id: "reply", kind: "response", onDate: TONIGHT }),
    ];
    expect(tonightOperatorFacts(rows, NOW).map((f) => f.id).sort()).toEqual([
      "event-tonight",
      "offer-tonight",
    ]);
    // At 02:00 on Monday the service night is still Sunday's.
    const lateNight = Date.parse("2026-11-02T02:00:00.000Z");
    expect(operatorServiceDay(lateNight)).toBe(TONIGHT);
    // At 05:00 on Monday it has turned: Sunday's rows go and Monday's is tonight's.
    expect(
      tonightOperatorFacts(rows, Date.parse("2026-11-02T05:00:00.000Z")).map((f) => f.id),
    ).toEqual(["event-tomorrow"]);
  });

  it("says its kind and its dates in plain words", () => {
    expect(Object.values(OPERATOR_FACT_KIND_LABEL)).toEqual(["Event", "Offer", "Correction", "Response"]);
    expect(operatorFactOnDay("2026-11-07")).toBe("Sat 7 Nov");
    expect(operatorFactAddedLine({ publishedAt: "2026-11-01T10:00:00.000Z" })).toBe(
      "Added by the pub, 1 Nov 2026",
    );
  });
});

describe("the memory operator facts store", () => {
  beforeEach(() => __resetOperatorFacts());

  it("publishes once per proposal and republishes in place", async () => {
    const first = await memoryOperatorFactsStore.publish(proposal(), NOW);
    const again = await memoryOperatorFactsStore.publish(proposal(), NOW + 1000);
    expect(again.id).toBe(first.id);
    const read = await memoryOperatorFactsStore.listPublishedForVenue("venue-synthetic");
    expect(read.facts).toHaveLength(1);
  });

  it("withdraws a published fact so no read returns it", async () => {
    await memoryOperatorFactsStore.publish(proposal({ payload: { title: "Quiz", startsAt: "8pm", onDate: TONIGHT } }), NOW);
    expect((await memoryOperatorFactsStore.listPublishedForDay(TONIGHT)).facts).toHaveLength(1);
    expect(await memoryOperatorFactsStore.withdraw("proposal-1", NOW)).toBe(true);
    expect(await memoryOperatorFactsStore.withdraw("proposal-1", NOW)).toBe(false);
    expect((await memoryOperatorFactsStore.listPublishedForVenue("venue-synthetic")).facts).toEqual([]);
    expect((await memoryOperatorFactsStore.listPublishedForDay(TONIGHT)).facts).toEqual([]);
  });

  it("reads a night's facts by date and kind alone", async () => {
    await memoryOperatorFactsStore.publish(
      proposal({ id: "p-offer", type: "offer", payload: { title: "Two for one", body: "Ales", onDate: TONIGHT } }),
      NOW,
    );
    await memoryOperatorFactsStore.publish(
      proposal({ id: "p-later", payload: { title: "Quiz", startsAt: "8pm", onDate: "2026-11-02" } }),
      NOW,
    );
    const night = await memoryOperatorFactsStore.listPublishedForDay(TONIGHT);
    expect(night.facts.map((f) => f.proposalId)).toEqual(["p-offer"]);
  });
});

// ── The routes, end to end ──────────────────────────────────────────────────

function post(body: unknown, admin = false): Request {
  const request = new Request("http://localhost/api/operator-proposals", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  });
  if (admin) request.headers.set("x-admin-token", "test-admin-secret");
  return request;
}

async function sheet(venueId: string): Promise<{ status: string; facts: Record<string, unknown>[] }> {
  const res = await getFacts(
    new Request(`http://localhost/api/operator-facts?venueId=${encodeURIComponent(venueId)}`),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { status: string; facts: Record<string, unknown>[] };
}

async function propose(body: unknown): Promise<string> {
  const res = await POST(post(body));
  expect(res.status).toBe(201);
  return ((await res.json()) as { proposal: { id: string } }).proposal.id;
}

describe("accepting, declining and reading operator facts", () => {
  beforeEach(async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.ADMIN_TOKEN = "test-admin-secret";
    __resetOperatorProposals();
    __resetOperatorFacts();
    __resetVenueOperators();
    __resetPintDrops();
    auth.identity = { id: "acct-1", email: null };
    const claim = await memoryVenueOperatorStore.claim({
      accountId: "acct-1",
      venueId: "v1",
      evidenceKind: "email-domain",
      evidenceNote: "domain",
    });
    await memoryVenueOperatorStore.setState(claim.id, "verified");
  });

  afterEach(() => vi.clearAllMocks());

  it("an accepted proposal persists and the venue sheet reads it", async () => {
    const id = await propose({ venueId: "v1", type: "event", payload: { title: "Quiz night", startsAt: "Thursdays, 8pm" } });
    const res = await POST(post({ action: "accept", id }, true));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fact: Record<string, unknown>; materialized: { authority: string } };
    expect(body.materialized.authority).toBe("operator");
    expect(body.fact).toMatchObject({ kind: "event", title: "Quiz night", when: "Thursdays, 8pm" });
    expect(body.fact).not.toHaveProperty("accountId");

    const read = await sheet("v1");
    expect(read.status).toBe("ready");
    expect(read.facts).toHaveLength(1);
    expect(read.facts[0]).toMatchObject({ kind: "event", title: "Quiz night", venueId: "v1" });
    // No account id and no proposal id reach a reader.
    expect(JSON.stringify(read)).not.toContain("acct-1");
    expect(JSON.stringify(read)).not.toContain(id);
  });

  it("a pending proposal never shows", async () => {
    await propose({ venueId: "v1", type: "offer", payload: { title: "Two for one", body: "Cask ales" } });
    expect((await sheet("v1")).facts).toEqual([]);
  });

  it("a declined proposal never shows, and a decline after an accept takes it down", async () => {
    const declined = await propose({ venueId: "v1", type: "response", payload: { body: "Thanks, sorted." } });
    expect((await POST(post({ action: "decline", id: declined }, true))).status).toBe(200);
    expect((await sheet("v1")).facts).toEqual([]);

    const accepted = await propose({ venueId: "v1", type: "correction", payload: { field: "Hours", body: "Till 1am" } });
    expect((await POST(post({ action: "accept", id: accepted }, true))).status).toBe(200);
    expect((await sheet("v1")).facts).toHaveLength(1);
    expect((await POST(post({ action: "decline", id: accepted }, true))).status).toBe(200);
    expect((await sheet("v1")).facts).toEqual([]);
    expect(await memoryOperatorProposalStore.listAcceptedForVenue("v1")).toEqual([]);
  });

  it("a publish that fails leaves the proposal pending and shows nothing", async () => {
    const id = await propose({ venueId: "v1", type: "event", payload: { title: "Quiz", startsAt: "8pm" } });
    const spy = vi.spyOn(memoryOperatorFactsStore, "publish").mockRejectedValueOnce(new Error("store down"));
    const res = await POST(post({ action: "accept", id }, true));
    expect(res.status).toBe(503);
    spy.mockRestore();
    expect((await memoryOperatorProposalStore.getById(id))?.status).toBe("pending");
    expect((await sheet("v1")).facts).toEqual([]);
  });

  it("a status stamp that fails after the publish takes the fact back down", async () => {
    const id = await propose({ venueId: "v1", type: "event", payload: { title: "Quiz", startsAt: "8pm" } });
    const spy = vi.spyOn(memoryOperatorProposalStore, "setStatus").mockRejectedValueOnce(new Error("store down"));
    const res = await POST(post({ action: "accept", id }, true));
    expect(res.status).toBe(503);
    spy.mockRestore();
    expect((await sheet("v1")).facts).toEqual([]);
  });

  it("refuses a read with no pub", async () => {
    const res = await getFacts(new Request("http://localhost/api/operator-facts"));
    expect(res.status).toBe(400);
  });
});
