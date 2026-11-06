import { describe, expect, it } from "vitest";
import {
  buildPlanGenerationIntakeBody, createPlanIntakeDraft, defaultLondonStartInput, londonDateTimeInputToIso,
  type PlanGenerationIntakeBody, type PlanTimeWindowId,
} from "@/lib/planIntake";
import { parsePlanGenerationRequest } from "@/lib/planGenerationRequest";
import { reconcilePlanContext } from "@/lib/planGenerationContext";

async function reconcileBody(body: PlanGenerationIntakeBody, now: Date) {
  const parsed = await parsePlanGenerationRequest(new Request("http://localhost/api/plans/generate", {
    method: "POST", body: JSON.stringify(body),
  }), now);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  return reconcilePlanContext(parsed.value.query, parsed.value.context, parsed.value.intake, now, parsed.value.planStartIso);
}

describe("automatic Plan start", () => {
  // The published First pint policy schedules 18:00 in the morning.
  // The generation context must describe that schedule, not the morning clock.
  it("uses the scheduled First pint for the morning untimed example without claiming an explicit time", async () => {
    const now = new Date("2026-11-05T09:00:00.000Z");
    const body = buildPlanGenerationIntakeBody(createPlanIntakeDraft(), "Quiet in Clapham for 4, not pricey", null, {}, null, "2026-11-05T18:00:00.000Z");
    expect(defaultLondonStartInput(now)).toBe("2026-11-05T18:00");
    expect(body.context).not.toHaveProperty("daypart");
    expect(body.intake.timeWindow).toBeNull();
    const result = await reconcileBody(body, now);
    expect(result.context.daypart).toBe("after_work");
    expect(result.fieldSources.daypart).toBe("default");
    expect(result.reasons.filter((reason) => reason.field === "daypart")).toEqual([]);
  });

  // Worked London wall times from the existing quarter-hour and late-window policy.
  it.each([
    ["2026-07-20T08:00:00.000Z", "2026-07-20T18:00", "after_work"],
    ["2026-07-20T16:40:00.000Z", "2026-07-20T18:00", "after_work"],
    ["2026-07-20T17:50:00.000Z", "2026-07-20T19:15", "evening"],
    ["2026-11-05T20:00:00.000Z", "2026-11-05T20:15", "evening"],
    ["2026-10-15T21:45:00.000Z", "2026-10-16T19:00", "evening"],
    ["2026-10-15T23:40:00.000Z", "2026-10-16T19:00", "evening"],
    ["2026-10-24T21:45:00.000Z", "2026-10-25T19:00", "evening"],
  ])("keeps the scheduled default at %s coherent with %s", async (clock, schedule, daypart) => {
    const now = new Date(clock);
    const body = buildPlanGenerationIntakeBody(createPlanIntakeDraft(), "Quiet in Clapham for 4, not pricey", null, {}, null, londonDateTimeInputToIso(schedule));
    expect(defaultLondonStartInput(now)).toBe(schedule);
    const result = await reconcileBody(body, now);
    expect(result.context.daypart).toBe(daypart);
    expect(result.fieldSources.daypart).toBe("default");
    expect(body.intake.timeWindow).toBeNull();
  });

  it.each([
    ["Daytime in Clapham", "daytime"],
    ["Get home from Clapham", "get_home"],
    ["Clapham tonight", "evening"],
    ["Clapham after work", "after_work"],
    ["Clapham late night", "late_night"],
  ])("keeps current query time ahead of the automatic fallback: %s", async (query, daypart) => {
    const body = buildPlanGenerationIntakeBody(createPlanIntakeDraft(), query, null, {}, null, "2026-11-05T20:00:00.000Z");
    const result = await reconcileBody(body, new Date("2026-11-05T09:00:00.000Z"));
    expect(result.context.daypart).toBe(daypart);
    expect(result.fieldSources.daypart).toBe("query");
    expect(body.intake.timeWindow).toBeNull();
  });

  it.each(["daytime", "get_home", "evening", "late_night", "after_work"] as const)(
    "keeps an explicit Tune %s without inventing a preset", async (daypart) => {
      const body = buildPlanGenerationIntakeBody(createPlanIntakeDraft(), "Clapham tonight", null, { daypart }, null, "2026-11-05T18:00:00.000Z");
      const result = await reconcileBody(body, new Date("2026-11-05T09:00:00.000Z"));
      expect(result.context.daypart).toBe(daypart);
      expect(result.fieldSources.daypart).toBe("context");
      expect(body.intake.timeWindow).toBeNull();
    },
  );

  it.each([
    ["after-work", "2026-11-05T18:15:00.000Z", "after_work"],
    ["evening", "2026-11-05T20:15:00.000Z", "evening"],
    ["late", "2026-11-05T23:15:00.000Z", "late_night"],
  ] satisfies [PlanTimeWindowId, string, string][])(
    "keeps the manually adjusted exact %s intake ahead of query and context", async (timeWindow, exactStartIso, daypart) => {
      const draft = createPlanIntakeDraft();
      draft.answers.timeWindow = timeWindow;
      draft.answers.exactStartIso = exactStartIso;
      const body = buildPlanGenerationIntakeBody(draft, "Daytime in Clapham", null, { daypart: "get_home" }, null, "2026-11-05T20:00:00.000Z");
      const result = await reconcileBody(body, new Date("2026-11-05T09:00:00.000Z"));
      expect(result.context.daypart).toBe(daypart);
      expect(result.fieldSources.daypart).toBe("intake");
      expect(body.intake.timeWindow?.exactStartIso).toBe(exactStartIso);
    },
  );
});
