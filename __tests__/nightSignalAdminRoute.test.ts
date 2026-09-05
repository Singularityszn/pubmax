// The moderator door onto the Night Signal candidate queue.
//
// It exists because a serverless sweep cannot own a git-PR review flow: the
// cron stores PENDING candidates and a person advances them here. The gate is
// the SHARED admin credential, so this file also holds the three callers apart
// - a moderator, a signed-in member, and a stranger - because approving is what
// puts a third-party claim in front of readers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The per-IP budget is real in the route and doubled here, because every case
// in this file arrives from one address and a fixed clock never reopens the
// window. One case still proves the door consults it.
const { isLimitedMock } = vi.hoisted(() => ({ isLimitedMock: vi.fn(async () => false) }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});

import { GET, POST } from "@/app/api/admin/night-signals/route";
import type { NightSignalClaim } from "@/lib/nightSignalClaims";
import {
  emptyNightSignalCheckpoint,
  MAX_QUERY_ATTEMPTS,
  NIGHT_SIGNAL_SWEEP_SCOPE,
  recordQueryFailure,
} from "@/lib/nightSignalReview";
import {
  nightSignalCandidateStore,
  nightSignalCheckpointStore,
  resetNightSignalStoreMemory,
} from "@/lib/nightSignalStore.server";

const NOW = Date.parse("2026-09-05T20:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const CANDIDATE_ID = "opening:camden:20260901:abcd1234";
const OPENING_QUERY = { kind: "opening", query: "new London pub or bar opening this month" };

/** A moderator carries the admin credential; a member carries only a bearer. */
type Caller = "moderator" | "member" | "anonymous";

function headersFor(caller: Caller): Record<string, string> {
  if (caller === "moderator") return { "x-admin-token": "the-real-token" };
  if (caller === "member") return { authorization: "Bearer a-members-session-token" };
  return {};
}

function get(caller: Caller = "moderator", query = ""): Request {
  return new Request(`https://pubmaxxing.com/api/admin/night-signals${query}`, {
    headers: headersFor(caller),
  });
}

function post(body: unknown, caller: Caller = "moderator"): Request {
  return new Request("https://pubmaxxing.com/api/admin/night-signals", {
    method: "POST",
    headers: { ...headersFor(caller), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function pendingCandidate(overrides: Partial<NightSignalClaim> = {}): NightSignalClaim {
  return {
    id: CANDIDATE_ID,
    kind: "opening",
    entity: { type: "night_area", id: "camden" },
    claim: "The Camden Arms reopens as a late-night taproom on Chalk Farm Road",
    sourceUrl: "https://example.com/london/camden-arms",
    publisher: "example.com",
    publishedAt: new Date(NOW - 3 * DAY).toISOString(),
    observedAt: new Date(NOW - DAY).toISOString(),
    expiresAt: new Date(NOW + 20 * DAY).toISOString(),
    confidence: 0.5,
    reviewState: "pending",
    verification: "single_source",
    routeEffect: "none",
    corroboratingSources: [],
    reviewedAt: null,
    reviewAuthority: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetNightSignalStoreMemory();
  isLimitedMock.mockReset();
  isLimitedMock.mockResolvedValue(false);
  // A route test that means to prove a moderator cell must SET the token: the
  // gate opens for everybody when ADMIN_TOKEN is unset under NODE_ENV=test.
  vi.stubEnv("ADMIN_TOKEN", "the-real-token");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who may open the queue", () => {
  it("refuses a stranger and a signed-in member alike", async () => {
    await nightSignalCandidateStore().save([pendingCandidate()]);
    for (const caller of ["anonymous", "member"] as const) {
      const listed = await GET(get(caller));
      expect(listed.status).toBe(403);
      const decided = await POST(post({ action: "approve", id: CANDIDATE_ID }, caller));
      expect(decided.status).toBe(403);
      // The refusal is the whole answer: nothing about the queue leaks with it.
      expect(await decided.json()).toMatchObject({ code: "FORBIDDEN" });
    }
    // And the candidate is untouched by either attempt.
    const still = await nightSignalCandidateStore().list({ state: "pending" });
    expect(still.status === "ready" && still.candidates).toHaveLength(1);
  });

  it("shows a moderator the pending queue and the sweep's own state", async () => {
    await nightSignalCandidateStore().save([pendingCandidate()]);
    const failed = recordQueryFailure(emptyNightSignalCheckpoint(NIGHT_SIGNAL_SWEEP_SCOPE, NOW), {
      query: { kind: "event", query: "best pint in London pub review feature" },
      reason: "Exa search failed (503).",
      now: NOW,
    });
    await nightSignalCheckpointStore().save(failed.checkpoint);

    const response = await GET(get());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.state).toBe("pending");
    expect(body.maxQueryAttempts).toBe(MAX_QUERY_ATTEMPTS);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ id: CANDIDATE_ID, reviewState: "pending" });
    expect(body.sweep.deferred[0]).toMatchObject({
      attempts: 1,
      reason: "Exa search failed (503).",
    });
  });

  it("refuses a review state it does not have", async () => {
    expect((await GET(get("moderator", "?status=published"))).status).toBe(400);
  });

  it("spends the same per-IP budget the other moderator doors spend", async () => {
    isLimitedMock.mockResolvedValue(true);
    expect((await GET(get())).status).toBe(429);
    expect((await POST(post({ action: "approve", id: CANDIDATE_ID }))).status).toBe(429);
  });
});

describe("advancing a candidate", () => {
  it("approves one, and the approved lane is what the feed may read", async () => {
    await nightSignalCandidateStore().save([pendingCandidate()]);

    const response = await POST(
      post({ action: "approve", id: CANDIDATE_ID, authority: "editorial" }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.candidate).toMatchObject({
      id: CANDIDATE_ID,
      reviewState: "approved",
      reviewAuthority: "editorial",
      reviewedAt: new Date(NOW).toISOString(),
    });

    const pending = await nightSignalCandidateStore().list({ state: "pending" });
    expect(pending.status === "ready" && pending.candidates).toHaveLength(0);
    const approved = await nightSignalCandidateStore().approved(NOW);
    expect(approved.status === "ready" && approved.candidates.map((row) => row.id)).toEqual([
      CANDIDATE_ID,
    ]);
  });

  it("rejects one, and a rejected candidate never reaches the feed", async () => {
    await nightSignalCandidateStore().save([pendingCandidate()]);
    expect((await POST(post({ action: "reject", id: CANDIDATE_ID }))).status).toBe(200);
    const approved = await nightSignalCandidateStore().approved(NOW);
    expect(approved.status === "ready" && approved.candidates).toHaveLength(0);
    const rejected = await nightSignalCandidateStore().list({ state: "rejected" });
    expect(rejected.status === "ready" && rejected.candidates).toHaveLength(1);
  });

  it("refuses a second decision and names the standing one", async () => {
    await nightSignalCandidateStore().save([pendingCandidate()]);
    await POST(post({ action: "reject", id: CANDIDATE_ID }));

    const second = await POST(post({ action: "approve", id: CANDIDATE_ID }));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      code: "ALREADY_REVIEWED",
      reviewState: "rejected",
      reviewAuthority: "operations",
    });
    const approved = await nightSignalCandidateStore().approved(NOW);
    expect(approved.status === "ready" && approved.candidates).toHaveLength(0);
  });

  it("refuses to approve a candidate that would publish nothing", async () => {
    await nightSignalCandidateStore().save([
      pendingCandidate({ expiresAt: new Date(NOW - 60_000).toISOString() }),
    ]);
    const response = await POST(post({ action: "approve", id: CANDIDATE_ID }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "CANDIDATE_EXPIRED" });
  });

  it("refuses an unknown candidate, an unknown action and an authority nobody may name", async () => {
    expect((await POST(post({ action: "approve", id: "nobody" }))).status).toBe(404);
    expect((await POST(post({ action: "publish", id: CANDIDATE_ID }))).status).toBe(400);
    expect((await POST(post({ action: "approve" }))).status).toBe(400);
    await nightSignalCandidateStore().save([pendingCandidate()]);
    const machine = await POST(
      post({ action: "approve", id: CANDIDATE_ID, authority: "automated" }),
    );
    expect(machine.status).toBe(400);
  });

  it("refuses a body that is not JSON", async () => {
    const response = await POST(
      new Request("https://pubmaxxing.com/api/admin/night-signals", {
        method: "POST",
        headers: { ...headersFor("moderator"), "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("the way back from a terminal query", () => {
  it("requeues what the attempt cap refused", async () => {
    let outcome = recordQueryFailure(emptyNightSignalCheckpoint(NIGHT_SIGNAL_SWEEP_SCOPE, NOW), {
      query: OPENING_QUERY,
      reason: "timeout",
      now: NOW,
    });
    for (let attempt = 1; attempt < MAX_QUERY_ATTEMPTS; attempt += 1) {
      outcome = recordQueryFailure(outcome.checkpoint, {
        query: OPENING_QUERY,
        reason: "timeout",
        now: NOW + attempt * DAY,
      });
    }
    await nightSignalCheckpointStore().save(outcome.checkpoint);

    const response = await POST(post({ action: "requeue" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, requeued: 1 });
    const after = await nightSignalCheckpointStore().read(NIGHT_SIGNAL_SWEEP_SCOPE, NOW);
    expect(after?.terminal).toHaveLength(0);
  });

  it("says so when there was nothing to requeue", async () => {
    await nightSignalCheckpointStore().save(
      emptyNightSignalCheckpoint(NIGHT_SIGNAL_SWEEP_SCOPE, NOW),
    );
    const response = await POST(post({ action: "requeue" }));
    expect(await response.json()).toMatchObject({ requeued: 0 });
  });
});
