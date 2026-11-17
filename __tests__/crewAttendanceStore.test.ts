import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCrewAttendanceStore } from "@/lib/crewAttendanceStore.server";
import { SocialCrewStoreError } from "@/lib/socialCrewStoreError";

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
});
