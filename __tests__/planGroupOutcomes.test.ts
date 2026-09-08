import { beforeEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storeBackend", () => ({ admin: () => ({ rpc }) }));
import { readPlanGroupOutcomes } from "@/lib/planGroupOutcomes.server";

const from = "2020-02-03T00:00:00Z";
const until = "2020-02-10T00:00:00Z";
const specification = "fixture-reviewed";
const row = {
  week_start: "2020-02-03", status: "ready", groups_completed: 2, groups_repeated: 1,
  repeat_rate: 0.5, unresolved_completions: 0, capture_started_at: "2020-01-01T00:00:00Z",
};
beforeEach(() => rpc.mockReset());

it("requires explicit account exclusions instead of treating a production build as a cohort", async () => {
  rpc.mockResolvedValue({ data: [{ ...row, status: "cohort_unresolved", groups_completed: null, groups_repeated: null, repeat_rate: null }], error: null });
  const result = await readPlanGroupOutcomes(from, until);
  expect(rpc).toHaveBeenCalledWith("read_plan_group_outcomes", {
    p_from: from, p_until: until, p_specification_reference: null,
  });
  expect(result).toMatchObject({ status: "available", weeks: [{ status: "cohort_unresolved", groupsCompleted: null, repeatRate: null }] });
});

it("selects stored trusted evidence by reference and projects only aggregate fields", async () => {
  rpc.mockResolvedValue({ data: [{ ...row, plan_id: "private-plan", user_id: "private-account", handle: "private-handle", coordinates: [1, 2] }], error: null });
  const result = await readPlanGroupOutcomes(from, until, specification);
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_specification_reference: specification });
  expect(result).toEqual({ status: "available", weeks: [{
    weekStart: row.week_start, status: "ready", groupsCompleted: 2, groupsRepeated: 1,
    repeatRate: 0.5, unresolvedCompletions: 0, captureStartedAt: row.capture_started_at,
  }] });
});

it("preserves zero counts and an undefined rate for a proven empty cohort", async () => {
  rpc.mockResolvedValue({ data: [{ ...row, groups_completed: 0, groups_repeated: 0, repeat_rate: null }], error: null });
  expect(await readPlanGroupOutcomes(from, until, specification)).toMatchObject({ weeks: [{ groupsCompleted: 0, groupsRepeated: 0, repeatRate: null }] });
});

it("preserves partial-history counts without publishing an exact rate", async () => {
  rpc.mockResolvedValue({ data: [{ ...row, status: "partial", repeat_rate: null, unresolved_completions: 1 }], error: null });
  expect(await readPlanGroupOutcomes(from, until, specification)).toMatchObject({ weeks: [{ status: "partial", repeatRate: null, unresolvedCompletions: 1 }] });
});

it.each([
  { ...row, status: "partial" },
  { ...row, groups_repeated: 3 },
  { ...row, repeat_rate: 0.8 },
  { ...row, groups_completed: "2" },
  { ...row, status: "cohort_unresolved" },
])("refuses inconsistent aggregate evidence: %j", async (invalid) => {
  rpc.mockResolvedValue({ data: [invalid], error: null });
  expect(await readPlanGroupOutcomes(from, until, specification)).toEqual({ status: "unavailable" });
});

it.each([{ data: null, error: { message: "Missing schema" } }, { data: [], error: null }])("never reports an unsuccessful query as zero", async (reply) => {
  rpc.mockResolvedValue(reply);
  expect(await readPlanGroupOutcomes(from, until, specification)).toEqual({ status: "unavailable" });
});

it("contains a rejected store read", async () => {
  rpc.mockRejectedValue(new Error("Connection failed"));
  expect(await readPlanGroupOutcomes(from, until, specification)).toEqual({ status: "unavailable" });
});

it("rejects a reversed window before reading the store", async () => {
  expect(await readPlanGroupOutcomes(until, from)).toEqual({ status: "unavailable" });
  expect(rpc).not.toHaveBeenCalled();
});
