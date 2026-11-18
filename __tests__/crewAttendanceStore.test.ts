import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const edge = vi.hoisted(() => ({ rpc: vi.fn(), frozen: false }));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  requireDynamicSupabaseAdmin: () => ({ rpc: async (name: string, input: unknown) => ({ data: await edge.rpc(name, input), error: null }) }),
}));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: vi.fn(async () => ({
    ok: true,
    actor: { accountId: "10000000-0000-4000-8000-000000000001", profileId: "20000000-0000-4000-8000-000000000001", handle: "host" },
  })),
}));
vi.mock("@/lib/opsFreeze", () => ({
  socialFreezeResponse: () => (edge.frozen ? new Response(null, { status: 503 }) : null),
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn(async () => false) }));

import { POST as attestRoute } from "@/app/api/social/crews/[crewId]/attendance/route";
import { POST as reportRoute } from "@/app/api/social/crews/[crewId]/attendance/report/route";
import { createCrewAttendanceStore } from "@/lib/crewAttendanceStore.server";
import { SocialCrewStoreError } from "@/lib/socialCrewStoreError";
import { socialCrewErrorResponse } from "@/lib/socialCrewHttp";

const CREW = "50000000-0000-4000-8000-000000000001";
const ANA = "30000000-0000-4000-8000-000000000002";
const actor = { accountId: "10000000-0000-4000-8000-000000000001", profileId: "20000000-0000-4000-8000-000000000001", handle: "host" };
const KEY = "attendance-key-000001";
const hostRead = {
  canAttest: true, open: true, opensAt: "2026-11-17T00:00:00.000Z", closesAt: "2026-11-18T08:00:00.000Z",
  items: [{ memberId: ANA, state: "attended", revision: 1, recordedAt: "2026-11-17T20:10:00.000Z", recordedBy: "host" }],
};

const storeAnswering = (answer: () => unknown) => {
  const rpc = vi.fn(async () => answer());
  return { rpc, store: createCrewAttendanceStore({ rpc }) };
};
const failure = (promise: Promise<unknown>) => promise.then(
  () => { throw new Error("expected a refusal"); },
  (error: unknown) => {
    expect(error).toBeInstanceOf(SocialCrewStoreError);
    return (error as SocialCrewStoreError).code;
  },
);

describe("host attendance store", () => {
  it("reads the server's attendance for this viewer and crew", async () => {
    const { rpc, store } = storeAnswering(() => hostRead);
    await expect(store.read(CREW, actor)).resolves.toEqual(hostRead);
    expect(rpc).toHaveBeenCalledWith("read_social_crew_attendance", {
      p_viewer_account_id: actor.accountId, p_viewer_profile_id: actor.profileId, p_crew_id: CREW,
    });
  });

  it("a crew the viewer cannot read is not found, and a failed or malformed read is unavailable, never empty", async () => {
    expect(await failure(storeAnswering(() => null).store.read(CREW, actor))).toBe("NOT_FOUND");
    expect(await failure(storeAnswering(() => { throw new Error("down"); }).store.read(CREW, actor))).toBe("UNAVAILABLE");
    for (const broken of [
      { ...hostRead, items: undefined },
      { ...hostRead, items: [{ ...hostRead.items[0], state: "maybe" }] },
      { ...hostRead, items: [{ ...hostRead.items[0], revision: -1 }] },
      { ...hostRead, items: [{ ...hostRead.items[0], state: null, revision: 2 }] },
      { ...hostRead, items: [hostRead.items[0], hostRead.items[0]] },
      { ...hostRead, closesAt: "tomorrow" },
    ]) {
      expect(await failure(storeAnswering(() => broken).store.read(CREW, actor)), JSON.stringify(broken)).toBe("UNAVAILABLE");
    }
  });

  it("sends one guarded write with the expected revision and returns the saved state", async () => {
    const { rpc, store } = storeAnswering(() => ({ ok: true, code: "attested", revision: 2, state: "absent" }));
    await expect(store.attest(actor, { crewId: CREW, memberId: ANA, state: "absent", expectedRevision: 1, idempotencyKey: KEY }))
      .resolves.toEqual({ memberId: ANA, state: "absent", revision: 2 });
    expect(rpc).toHaveBeenCalledWith("attest_social_crew_attendance_atomic", expect.objectContaining({
      p_actor_account_id: actor.accountId, p_crew_id: CREW, p_member_id: ANA, p_state: "absent",
      p_expected_revision: 1, p_idempotency_key: KEY, p_payload_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it("a replayed or unchanged answer is the saved state", async () => {
    for (const code of ["replayed", "unchanged"]) {
      const { store } = storeAnswering(() => ({ ok: true, code, revision: 1, state: "attended" }));
      await expect(store.attest(actor, { crewId: CREW, memberId: ANA, state: "attended", expectedRevision: 1, idempotencyKey: KEY }))
        .resolves.toEqual({ memberId: ANA, state: "attended", revision: 1 });
    }
  });

  it("maps each refusal to its honest status, and an unknown answer to unavailable", async () => {
    const cases: Array<[unknown, string]> = [
      [{ ok: false, code: "stale" }, "CONFLICT"],
      [{ ok: false, code: "closed" }, "CONFLICT"],
      [{ ok: false, code: "not_open" }, "CONFLICT"],
      [{ ok: false, code: "not_found" }, "NOT_FOUND"],
      [{ ok: false, code: "invalid" }, "INVALID"],
      [{ ok: false, code: "idempotency_conflict" }, "INVALID"],
      [{ ok: false, code: "something_new" }, "UNAVAILABLE"],
      [{ ok: true, code: "attested", revision: 0, state: "attended" }, "UNAVAILABLE"],
      [null, "UNAVAILABLE"],
    ];
    for (const [answer, code] of cases) {
      const { store } = storeAnswering(() => answer);
      expect(await failure(store.attest(actor, { crewId: CREW, memberId: ANA, state: "attended", expectedRevision: 0, idempotencyKey: KEY })),
        JSON.stringify(answer)).toBe(code);
    }
  });

  it("a conflict names its reason, and the API envelope carries it to the page", async () => {
    for (const reason of ["stale", "closed", "not_open"]) {
      const { store } = storeAnswering(() => ({ ok: false, code: reason }));
      const error = await store.attest(actor, { crewId: CREW, memberId: ANA, state: "attended", expectedRevision: 0, idempotencyKey: KEY })
        .then(() => null, (refusal: unknown) => refusal);
      expect(error).toBeInstanceOf(SocialCrewStoreError);
      const response = socialCrewErrorResponse(error);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "SOCIAL_CREW_CONFLICT", details: { reason } });
    }
    const other = await socialCrewErrorResponse(new SocialCrewStoreError("CONFLICT", 409, "owner cannot leave")).json();
    expect(other).not.toHaveProperty("details");
  });

  it("refuses a malformed write before it reaches the database", async () => {
    const { rpc, store } = storeAnswering(() => ({ ok: true }));
    for (const input of [
      { crewId: CREW, memberId: "not-a-member", state: "attended", expectedRevision: 0, idempotencyKey: KEY },
      { crewId: CREW, memberId: ANA, state: "here", expectedRevision: 0, idempotencyKey: KEY },
      { crewId: CREW, memberId: ANA, state: "attended", expectedRevision: -1, idempotencyKey: KEY },
      { crewId: CREW, memberId: ANA, state: "attended", expectedRevision: 1.5, idempotencyKey: KEY },
      { crewId: CREW, memberId: ANA, state: "attended", expectedRevision: 0, idempotencyKey: "short" },
    ]) {
      expect(await failure(store.attest(actor, input as never)), JSON.stringify(input)).toBe("INVALID");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a guest reports the mark they read by its revision, and a refusal says why", async () => {
    const { rpc, store } = storeAnswering(() => ({ ok: true, code: "reported", revision: 2 }));
    await expect(store.report(actor, { crewId: CREW, revision: 2 })).resolves.toEqual({ code: "reported", revision: 2 });
    expect(rpc).toHaveBeenCalledWith("report_social_crew_attendance", {
      p_viewer_account_id: actor.accountId, p_viewer_profile_id: actor.profileId, p_crew_id: CREW, p_revision: 2,
    });
    await expect(storeAnswering(() => ({ ok: true, code: "decided", revision: 2 })).store.report(actor, { crewId: CREW, revision: 2 }))
      .resolves.toEqual({ code: "decided", revision: 2 });
    const cases: Array<[unknown, string]> = [
      [{ ok: false, code: "stale" }, "CONFLICT"],
      [{ ok: false, code: "not_found" }, "NOT_FOUND"],
      [{ ok: false, code: "invalid" }, "INVALID"],
      [{ ok: true, code: "reported", revision: 3 }, "UNAVAILABLE"],
      [{ ok: true, code: "something_new", revision: 2 }, "UNAVAILABLE"],
      [null, "UNAVAILABLE"],
    ];
    for (const [answer, code] of cases) {
      expect(await failure(storeAnswering(() => answer).store.report(actor, { crewId: CREW, revision: 2 })), JSON.stringify(answer)).toBe(code);
    }
    const quiet = storeAnswering(() => ({ ok: true }));
    for (const revision of [0, -1, 1.5, Number.NaN]) {
      expect(await failure(quiet.store.report(actor, { crewId: CREW, revision })), String(revision)).toBe("INVALID");
    }
    expect(await failure(quiet.store.report(actor, { crewId: "crew", revision: 1 }))).toBe("INVALID");
    expect(quiet.rpc).not.toHaveBeenCalled();
  });
});

describe("attendance report route", () => {
  const url = `http://localhost/api/social/crews/${CREW}/attendance`;
  const params = { params: Promise.resolve({ crewId: CREW }) };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  beforeEach(() => {
    edge.rpc.mockReset();
    edge.frozen = false;
  });

  it("files a report while Social is frozen, as every report does, and a host's mark still waits", async () => {
    edge.frozen = true;
    edge.rpc.mockResolvedValue({ ok: true, code: "reported", revision: 2 });
    const response = await reportRoute(post(`${url}/report`, { revision: 2 }), params);
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ code: "reported", revision: 2 });
    expect(edge.rpc).toHaveBeenCalledWith("report_social_crew_attendance", expect.objectContaining({ p_crew_id: CREW, p_revision: 2 }));
    const mark = await attestRoute(post(url, { memberId: ANA, state: "attended", expectedRevision: 0 }, { "idempotency-key": KEY }), params);
    expect(mark.status).toBe(503);
    expect(edge.rpc).toHaveBeenCalledTimes(1);
  });

  it("takes only the revision, and a mark that changed is a named conflict", async () => {
    for (const body of [{}, { revision: "2" }, { revision: 2, memberId: ANA }, { revision: 2, crewId: CREW }]) {
      expect((await reportRoute(post(`${url}/report`, body), params)).status, JSON.stringify(body)).toBe(400);
    }
    expect(edge.rpc).not.toHaveBeenCalled();
    edge.rpc.mockResolvedValue({ ok: false, code: "stale" });
    const stale = await reportRoute(post(`${url}/report`, { revision: 2 }), params);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ details: { reason: "stale" } });
  });
});
