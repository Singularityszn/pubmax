import { describe, expect, it, onTestFinished, vi } from "vitest";
import { checkHours, compareHours, planHoursCheck } from "../scripts/lib/placesHoursCheck";
import { defined } from "@/__tests__/helpers/defined";

describe("opening-hours verification", () => {
  it("spends the remaining free allowance then caps paid Details calls", () => {
    expect(planHoursCheck(2000, 48, 20)).toEqual({ calls: 1952, freeCalls: 952, projectedUsd: 20 });
    expect(planHoursCheck(2000, null, 20)).toEqual({ calls: 1000, freeCalls: 0, projectedUsd: 20 });
  });
  it("compares equivalent overnight periods without storing Google hours", () => {
    const ours = { 6: [{ opens: "20:00", closes: "02:00" }] };
    const periods = [{ open: { day: 6, hour: 20 }, close: { day: 0, hour: 2 } }];
    expect(compareHours(ours, periods)).toBe("match");
    expect(compareHours(ours, [{ open: { day: 6, hour: 20 }, close: { day: 0, hour: 3 } }])).toBe("mismatch");
    expect(compareHours(null, periods)).toBe("unknown");
  });
  it("stores only derived verdicts and place IDs, and never sends beyond the budget", async () => {
    // A run at 20:00 stamps "T20:00:..." into verifiedAt, which must not read as leaked hours.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T20:00:47.094Z"));
    onTestFinished(() => { vi.useRealTimers(); });
    const snapshots: unknown[] = [];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      displayName: { text: "GOOGLE NAME MUST NOT PERSIST" },
      regularOpeningHours: { periods: [{ open: { day: 6, hour: 20 }, close: { day: 0, hour: 2 } }] },
    }), { status: 200 }));
    const result = await checkHours({
      venues: ["a", "b"].map((id) => ({ venueId: id, googlePlaceId: `place-${id}`,
        hours: { 6: [{ opens: "20:00", closes: "02:00" }] } })),
      apiKey: "fake-test-key", maxCalls: 1, fetchImpl,
      save: (rows, calls) => snapshots.push(JSON.parse(JSON.stringify({ rows, calls }))),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.calls).toBe(1);
    expect(defined(result.rows[0]).verdict).toBe("match");
    expect(Object.keys(defined(result.rows[0])).sort()).toEqual(["googlePlaceId", "venueId", "verdict", "verifiedAt"]);
    expect(snapshots[0]).toEqual({ rows: [], calls: 1 });
    expect(defined(result.rows[0]).verifiedAt).toBe("2026-10-07T20:00:47.094Z");
    expect(JSON.stringify(snapshots)).not.toMatch(/GOOGLE NAME|periods|"20:00"|fake-test-key/);
  });
  it.each([400, 401, 403, 429, 503])("reserves HTTP %s requests and stops without automatic retries", async (status) => {
    const save = vi.fn();
    const fetchImpl = vi.fn(async () => new Response("unavailable", { status }));
    await expect(checkHours({ venues: [{ venueId: "a", googlePlaceId: "place-a", hours: { 1: [{ opens: "10:00", closes: "20:00" }] } }],
      apiKey: "test", maxCalls: 2, fetchImpl, save })).rejects.toThrow(`HTTP ${status}`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith([], 1);
  });
  it("records pubs without stored hours as unknown without a Details call", async () => {
    const save = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      regularOpeningHours: { periods: [{ open: { day: 1, hour: 10 }, close: { day: 1, hour: 20 } }] },
    }), { status: 200 }));
    const result = await checkHours({
      venues: [
        { venueId: "a", googlePlaceId: "place-a", hours: null },
        { venueId: "b", googlePlaceId: "place-b", hours: {} },
        { venueId: "c", googlePlaceId: "place-c", hours: { 1: [{ opens: "10:00", closes: "20:00" }] } },
        { venueId: "d", googlePlaceId: "place-d", hours: { 1: [{ opens: "10:00", closes: "21:00" }] } },
        { venueId: "e", googlePlaceId: "place-e", hours: null },
      ],
      apiKey: "test", maxCalls: 1, fetchImpl, save,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("place-c"), expect.anything());
    expect(result.calls).toBe(1);
    expect(result.rows.map((row) => [row.venueId, row.verdict])).toEqual([
      ["a", "unknown"], ["b", "unknown"], ["c", "match"], ["e", "unknown"],
    ]);
  });
  it("recognises continuous hours across split periods and midnight, and rejects incomplete inputs", () => {
    expect(compareHours({ 1: [{ opens: "10:00", closes: "20:00" }] }, [
      { open: { day: 1, hour: 10 }, close: { day: 1, hour: 14 } },
      { open: { day: 1, hour: 14 }, close: { day: 1, hour: 20 } },
    ])).toBe("match");
    expect(compareHours({ 1: [{ opens: "20:00", closes: "24:00" }] }, [
      { open: { day: 1, hour: 20 }, close: { day: 2, hour: 0 } },
    ])).toBe("match");
    const always = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, [{ opens: "00:00", closes: "24:00" }]]));
    expect(compareHours(always, [{ open: { day: 0 } }])).toBe("match");
    expect(compareHours(always, [{ open: { day: 8 } }])).toBe("unknown");
    expect(compareHours(always, [])).toBe("unknown");
    expect(compareHours({}, [{ open: { day: 0 } }])).toBe("unknown");
    expect(() => planHoursCheck(2000, -1, 20)).toThrow();
  });
});
