// "Is the kitchen still open?" (A1): the closed vocabulary, the read copy, the
// tap rule and the process-memory store behind it.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

import {
  KITCHEN_FRESH_WINDOW_MS,
  KITCHEN_TAP_LABELS,
  kitchenReadingLine,
  kitchenReportOwnerFields,
  parseKitchenReading,
  parseKitchenState,
  planKitchenTap,
} from "@/lib/kitchenReports";
import { __resetKitchenReports, memoryKitchenReportsStore } from "@/lib/kitchenReportsStore";
import { OCCUPANCY_FRESH_WINDOW_MS } from "@/lib/occupancy";

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";
const CAROL = "c3333333-3333-4333-8333-333333333333";
const VENUE = "venue-crown";
const T0 = Date.parse("2026-10-30T19:00:00.000Z");
const MIN = 60_000;

describe("the kitchen vocabulary and copy", () => {
  it("takes exactly two words and refuses anything near them", () => {
    expect(parseKitchenState("open")).toBe("open");
    expect(parseKitchenState("closed")).toBe("closed");
    for (const near of ["Open", " open", "shut", "serving", "", null, 1, undefined]) {
      expect(parseKitchenState(near)).toBeNull();
    }
    expect(KITCHEN_TAP_LABELS).toEqual({ open: "Still serving", closed: "Kitchen closed" });
  });

  it("spends the crowd reading's 90 minute window, not a second one", () => {
    expect(KITCHEN_FRESH_WINDOW_MS).toBe(OCCUPANCY_FRESH_WINDOW_MS);
    expect(KITCHEN_FRESH_WINDOW_MS).toBe(90 * MIN);
  });

  it("prints whose word it is and how long ago, and nothing once the window passes", () => {
    const report = { state: "open" as const, handle: "alice", reportedAt: new Date(T0).toISOString(), confirmed: false };
    expect(kitchenReadingLine(report, T0 + 20 * MIN)).toBe("Kitchen open, said @alice 20 min ago");
    expect(kitchenReadingLine({ ...report, state: "closed" }, T0 + 20 * MIN)).toBe(
      "Kitchen closed, said @alice 20 min ago",
    );
    expect(kitchenReadingLine({ ...report, confirmed: true }, T0 + 20 * MIN)).toBe(
      "Kitchen open, said @alice 20 min ago, confirmed by one other",
    );
    expect(kitchenReadingLine(report, T0)).toBe("Kitchen open, said @alice just now");
    expect(kitchenReadingLine(report, T0 + 90 * MIN)).not.toBeNull();
    expect(kitchenReadingLine(report, T0 + 90 * MIN + 1)).toBeNull();
    expect(kitchenReadingLine({ ...report, handle: "" }, T0 + MIN)).toBeNull();
  });

  it("never prints hours, an em dash or an exclamation mark", () => {
    const line = kitchenReadingLine(
      { state: "closed", handle: "bob", reportedAt: new Date(T0).toISOString(), confirmed: true },
      T0 + 5 * MIN,
    );
    expect(line).not.toMatch(/[—!]|hours|until|till/i);
  });

  it("drops a stale or malformed read before it reaches a surface", () => {
    const report = { id: "k1", venueId: VENUE, state: "open", reportedAt: new Date(T0).toISOString(), handle: "alice", confirmed: true };
    expect(parseKitchenReading({ report }, T0 + MIN)).toEqual({ ...report, confirmed: true });
    expect(parseKitchenReading({ report }, T0 + 91 * MIN)).toBeNull();
    expect(parseKitchenReading({ report: { ...report, state: "maybe" } }, T0 + MIN)).toBeNull();
    expect(parseKitchenReading({ report: null }, T0)).toBeNull();
  });

  it("exports the word, the minute and whether it was confirmed, never the confirmer", () => {
    const fields = kitchenReportOwnerFields({
      id: "k1",
      venueId: VENUE,
      state: "open",
      reporterUserId: ALICE,
      reportedAt: new Date(T0).toISOString(),
      confirmedBy: BOB,
      confirmedAt: new Date(T0 + MIN).toISOString(),
    });
    expect(fields).toEqual({ id: "k1", venueId: VENUE, state: "open", reportedAt: new Date(T0).toISOString(), confirmed: true });
    expect(JSON.stringify(fields)).not.toContain(BOB);
  });
});

describe("the tap rule", () => {
  const latest = { id: "k1", state: "open" as const, reporterUserId: ALICE, confirmedAt: null };
  it("starts a report with no fresh one, or with the other word", () => {
    expect(planKitchenTap(null, "open", BOB)).toEqual({ kind: "report" });
    expect(planKitchenTap(latest, "closed", BOB)).toEqual({ kind: "report" });
    expect(planKitchenTap(latest, "closed", ALICE)).toEqual({ kind: "report" });
  });
  it("refuses the reporter's own confirmation, confirms another's once, and takes no third", () => {
    expect(planKitchenTap(latest, "open", ALICE)).toEqual({ kind: "own" });
    expect(planKitchenTap(latest, "open", BOB)).toEqual({ kind: "confirm", id: "k1" });
    expect(planKitchenTap({ ...latest, confirmedAt: "x" }, "open", CAROL)).toEqual({ kind: "already" });
  });
});

describe("the memory store", () => {
  beforeEach(() => __resetKitchenReports());

  it("a report, then another account's matching tap inside the window confirms it", async () => {
    const first = await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "open", userId: ALICE }, T0);
    expect(first.outcome).toBe("reported");
    const second = await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "open", userId: BOB }, T0 + 10 * MIN);
    expect(second.outcome).toBe("confirmed");
    const read = await memoryKitchenReportsStore.readLatest(VENUE, T0 + 11 * MIN);
    expect(read.report?.confirmedBy).toBe(BOB);
    expect(read.report?.reporterUserId).toBe(ALICE);
  });

  it("the reporter cannot confirm their own report", async () => {
    await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "closed", userId: ALICE }, T0);
    const own = await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "closed", userId: ALICE }, T0 + MIN);
    expect(own).toEqual({ outcome: "own" });
    expect((await memoryKitchenReportsStore.readLatest(VENUE, T0 + 2 * MIN)).report?.confirmedAt).toBeNull();
  });

  it("one confirmer and no third", async () => {
    await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "open", userId: ALICE }, T0);
    await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "open", userId: BOB }, T0 + MIN);
    expect(await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "open", userId: CAROL }, T0 + 2 * MIN)).toEqual({
      outcome: "already",
    });
    expect(await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "open", userId: BOB }, T0 + 3 * MIN)).toEqual({
      outcome: "already",
    });
    expect((await memoryKitchenReportsStore.readLatest(VENUE, T0 + 4 * MIN)).report?.confirmedBy).toBe(BOB);
  });

  it("a matching tap after the window starts a new report rather than confirming a stale one", async () => {
    await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "open", userId: ALICE }, T0);
    expect((await memoryKitchenReportsStore.readLatest(VENUE, T0 + 91 * MIN)).report).toBeNull();
    const late = await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "open", userId: BOB }, T0 + 91 * MIN);
    expect(late.outcome).toBe("reported");
    const read = await memoryKitchenReportsStore.readLatest(VENUE, T0 + 92 * MIN);
    expect(read.report?.reporterUserId).toBe(BOB);
    expect(read.report?.confirmedAt).toBeNull();
  });

  it("the other word starts a new report, and the newest is the one read", async () => {
    await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "open", userId: ALICE }, T0);
    await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "closed", userId: BOB }, T0 + 30 * MIN);
    const read = await memoryKitchenReportsStore.readLatest(VENUE, T0 + 31 * MIN);
    expect(read.report?.state).toBe("closed");
  });

  it("lists an account's own reports for the export, newest first", async () => {
    await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "open", userId: ALICE }, T0);
    await memoryKitchenReportsStore.tap({ venueId: "venue-other", state: "closed", userId: ALICE }, T0 + MIN);
    await memoryKitchenReportsStore.tap({ venueId: VENUE, state: "closed", userId: BOB }, T0 + 2 * MIN);
    const mine = await memoryKitchenReportsStore.listForOwner(ALICE);
    expect(mine.reports.map((row) => row.venueId)).toEqual(["venue-other", VENUE]);
  });
});
