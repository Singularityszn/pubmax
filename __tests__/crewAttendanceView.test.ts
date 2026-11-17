import { describe, expect, it } from "vitest";

import { crewAttendanceRefusal, type CrewAttendanceDTO } from "@/lib/crewAttendance";
import { CREW_ATTENDANCE_LOADING, nextCrewAttendanceView, type CrewAttendanceView } from "@/lib/crewAttendanceView";
import { afterCrewAttendanceWrite, holdCrewAttendanceWrite } from "@/lib/crewAttendanceWrites";

const ANA = "30000000-0000-4000-8000-000000000002";
const BEA = "30000000-0000-4000-8000-000000000003";
const OPENS = Date.parse("2026-11-17T00:00:00.000Z");
const CLOSES = Date.parse("2026-11-18T08:00:00.000Z");
const hostRead: CrewAttendanceDTO = {
  canAttest: true, open: true, opensAt: new Date(OPENS).toISOString(), closesAt: new Date(CLOSES).toISOString(),
  items: [
    { memberId: ANA, state: "attended", revision: 1, recordedAt: "2026-11-17T20:10:00.000Z", recordedBy: "host" },
    { memberId: BEA, state: null, revision: 0, recordedAt: null, recordedBy: null },
  ],
};
const NOW = Date.parse("2026-11-17T21:00:00.000Z");
const run = (view: CrewAttendanceView, ...events: Parameters<typeof nextCrewAttendanceView>[1][]) =>
  events.reduce(nextCrewAttendanceView, view);
const ready = run(CREW_ATTENDANCE_LOADING, { type: "loaded", data: hostRead, now: NOW });

describe("host attendance view", () => {
  it("a conflict keeps the rows and the pressed control while it reads again, and says which refusal it was", () => {
    const refused = run(ready, { type: "save", memberId: BEA, state: "attended" }, { type: "refused", reason: "stale" });
    expect(refused).toMatchObject({ status: "ready", refreshing: true, saving: null, notice: { kind: "refused", reason: "stale" } });
    if (refused.status !== "ready") throw new Error("rows dropped");
    expect(refused.data.items).toEqual(hostRead.items);
    const fresh: CrewAttendanceDTO = { ...hostRead, items: [
      { memberId: ANA, state: "attended", revision: 1, recordedAt: "2026-11-17T20:10:00.000Z", recordedBy: "host" },
      { memberId: BEA, state: "absent", revision: 1, recordedAt: "2026-11-17T20:50:00.000Z", recordedBy: "host" },
    ] };
    expect(run(refused, { type: "loaded", data: fresh, now: NOW })).toMatchObject({
      status: "ready", refreshing: false, data: fresh, notice: { kind: "refused", reason: "stale" },
    });
  });

  it("a refusal to read during recovery clears every private row", () => {
    const recovering = run(ready, { type: "save", memberId: BEA, state: "attended" }, { type: "refused", reason: "closed" });
    expect(run(recovering, { type: "missing" })).toEqual({ status: "hidden" });
    expect(run(ready, { type: "refresh" }, { type: "missing" })).toEqual({ status: "hidden" });
  });

  it("wakes at the real opening and closing, and not after the close", () => {
    const at = (now: number) => run(CREW_ATTENDANCE_LOADING, { type: "loaded", data: hostRead, now });
    expect(at(OPENS - 60_000)).toMatchObject({ boundary: { refreshAt: OPENS }, beforeOpen: true });
    expect(at(NOW)).toMatchObject({ boundary: { refreshAt: CLOSES }, beforeOpen: false });
    expect(at(CLOSES + 1)).toMatchObject({ boundary: { refreshAt: null }, beforeOpen: false });
    const before = at(OPENS - 60_000);
    if (before.status !== "ready") throw new Error("not read");
    for (const view of [run(before, { type: "refresh" }), run(before, { type: "save", memberId: BEA, state: "attended" })]) {
      expect(view.status === "ready" && view.boundary).toBe(before.boundary);
    }
  });

  it("one save at a time, only while open and settled, and a saved mark replaces its row", () => {
    const saving = run(ready, { type: "save", memberId: BEA, state: "attended" });
    expect(saving).toMatchObject({ saving: { memberId: BEA, state: "attended" }, notice: null });
    expect(run(saving, { type: "save", memberId: ANA, state: "absent" })).toBe(saving);
    const closed = run(CREW_ATTENDANCE_LOADING, { type: "loaded", data: { ...hostRead, open: false }, now: NOW });
    expect(run(closed, { type: "save", memberId: BEA, state: "attended" })).toBe(closed);
    const refreshing = run(ready, { type: "refresh" });
    expect(run(refreshing, { type: "save", memberId: BEA, state: "attended" })).toBe(refreshing);
    const saved = run(saving, { type: "saved", memberId: BEA, state: "attended", revision: 1, now: NOW });
    expect(saved).toMatchObject({ saving: null, notice: { kind: "saved", memberId: BEA, state: "attended" } });
    if (saved.status !== "ready") throw new Error("rows dropped");
    expect(saved.data.items[1]).toEqual({ memberId: BEA, state: "attended", revision: 1, recordedAt: new Date(NOW).toISOString(), recordedBy: "host" });
    expect(run(saving, { type: "saveFailed" })).toMatchObject({ status: "ready", saving: null, notice: { kind: "failed" } });
  });

  it("a failed first read is unavailable, and a retry reads again from loading", () => {
    const failed = run(CREW_ATTENDANCE_LOADING, { type: "failed" });
    expect(failed).toEqual({ status: "unavailable" });
    expect(run(failed, { type: "refresh" })).toEqual(CREW_ATTENDANCE_LOADING);
  });

  it("reads the refusal reason only from the server's closed vocabulary", () => {
    expect(crewAttendanceRefusal({ code: "SOCIAL_CREW_CONFLICT", details: { reason: "closed" } })).toBe("closed");
    expect(crewAttendanceRefusal({ code: "SOCIAL_CREW_CONFLICT", details: { reason: "not_open" } })).toBe("not_open");
    expect(crewAttendanceRefusal({ code: "SOCIAL_CREW_CONFLICT", details: { reason: "stale" } })).toBe("stale");
    for (const body of [null, {}, { details: null }, { details: { reason: "late" } }, { reason: "closed" }]) {
      expect(crewAttendanceRefusal(body), JSON.stringify(body)).toBeNull();
    }
  });

  it("a read waits for the same account's mark in flight on that crew, and for no other", async () => {
    let finish!: () => void;
    const write = holdCrewAttendanceWrite("crew-a|7", new Promise<void>((resolve) => { finish = resolve; }));
    const order: string[] = [];
    const waiting = afterCrewAttendanceWrite("crew-a|7").then(() => order.push("read crew-a"));
    await afterCrewAttendanceWrite("crew-a|8").then(() => order.push("read as another account"));
    await afterCrewAttendanceWrite("crew-b|7").then(() => order.push("read crew-b"));
    expect(order).toEqual(["read as another account", "read crew-b"]);
    finish();
    await write;
    await waiting;
    expect(order).toEqual(["read as another account", "read crew-b", "read crew-a"]);
  });

  it("a failed mark releases the read too", async () => {
    let fail!: (error: Error) => void;
    const write = holdCrewAttendanceWrite("crew-a|9", new Promise<void>((_resolve, reject) => { fail = reject; }));
    const waiting = afterCrewAttendanceWrite("crew-a|9");
    fail(new Error("offline"));
    await expect(write).rejects.toThrow("offline");
    await expect(waiting).resolves.toBeUndefined();
  });
});
