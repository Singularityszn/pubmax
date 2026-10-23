import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import PlanIntake from "@/components/plan/PlanIntake";

import {
  PLAN_INTAKE_DRAFT_TTL_MS,
  PLAN_INTAKE_STEPS,
  PLAN_INTAKE_STORAGE_KEY,
  buildPlanGenerationIntakeBody,
  canSeedPlanIntakeArea,
  clearPlanIntakeDraft,
  createPlanIntakeDraft,
  defaultLondonStartInput,
  londonDateTimeInputFromIso,
  londonDateTimeInputToIso,
  londonNightsAhead,
  nextLondonOccurrenceIso,
  parsePlanIntakeDraft,
  planIntakeHandoff,
  planIntakeNightContextPatch,
  planIntakeStepHasAnswer,
  readPlanIntakeDraft,
  reopenPlanIntakeStep,
  resolveFutureLondonStartIso,
  resolvePlanIntakeAreaSeed,
  settlePlanIntakeStep,
  skipRemainingPlanIntake,
  tonightLondonStartInput,
  writePlanIntakeDraft,
  type PlanIntakeDraft,
  type PlanIntakeStep,
} from "@/lib/planIntake";
import type { NightContext } from "@/lib/nightPlanning";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function answeredDraft(): PlanIntakeDraft {
  return {
    ...createPlanIntakeDraft(),
    currentStep: "accessibility",
    settledSteps: [...PLAN_INTAKE_STEPS],
    skippedSteps: [],
    completed: true,
    answers: {
      area: "london-bridge",
      timeWindow: "after-work",
      exactStartIso: "2026-07-20T16:30:00.000Z",
      groupSize: 5,
      budget: "value",
      budgetLimitPence: 2500,
      accessibilityNeeds: ["step-free", "accessible-toilet"],
    },
  };
}

function storedEnvelope(draft: PlanIntakeDraft, now = NOW): string {
  return JSON.stringify({
    storageVersion: 1,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PLAN_INTAKE_DRAFT_TTL_MS).toISOString(),
    draft,
  });
}

describe("progressive Plan intake", () => {
  it("starts with one area question and carries a remembered patch forward", () => {
    expect(createPlanIntakeDraft()).toMatchObject({
      currentStep: "area",
      settledSteps: [],
      completed: false,
      answers: { area: null, exactStartIso: null },
    });
    expect(createPlanIntakeDraft({ kind: "patch", id: "brixton" })).toMatchObject({
      currentStep: "time-window",
      settledSteps: ["area"],
      answers: { area: "brixton" },
    });
  });

  it("migrates only a legacy borough name that exactly matches a night patch", () => {
    expect(createPlanIntakeDraft({ kind: "borough", name: "Hackney" }).answers.area).toBe("hackney");
    expect(createPlanIntakeDraft({ kind: "borough", name: "City of Westminster" }).answers.area).toBeNull();
  });

  it("lets every step be skipped and clears every skipped answer", () => {
    let draft = createPlanIntakeDraft();
    for (const step of PLAN_INTAKE_STEPS) {
      expect(draft.currentStep).toBe(step);
      draft = settlePlanIntakeStep(draft, { skip: true });
    }
    expect(draft).toMatchObject({
      completed: true,
      settledSteps: PLAN_INTAKE_STEPS,
      skippedSteps: PLAN_INTAKE_STEPS,
      answers: {
        area: null,
        timeWindow: null,
        exactStartIso: null,
        groupSize: null,
        budget: null,
        budgetLimitPence: null,
        accessibilityNeeds: [],
      },
    });
  });

  it("refuses to settle an unanswered step unless it is explicitly skipped", () => {
    const draft = createPlanIntakeDraft();
    expect(settlePlanIntakeStep(draft)).toBe(draft);
    expect(settlePlanIntakeStep(draft, { skip: true })).not.toBe(draft);
  });

  it("keeps answered choices and skips only unanswered choices when switching to description", () => {
    const remembered = skipRemainingPlanIntake(createPlanIntakeDraft({ kind: "patch", id: "soho" }));
    expect(remembered.answers.area).toBe("soho");
    expect(remembered.skippedSteps).toEqual(PLAN_INTAKE_STEPS.slice(1));

    const selected = {
      ...createPlanIntakeDraft(),
      answers: { ...createPlanIntakeDraft().answers, area: "soho" as const },
    };
    const completed = skipRemainingPlanIntake(selected);
    expect(planIntakeStepHasAnswer(selected)).toBe(true);
    expect(completed.answers.area).toBe("soho");
    expect(completed.skippedSteps).not.toContain("area");
  });

  it("reopens one completed answer and resumes at that step", () => {
    const reopened = reopenPlanIntakeStep(answeredDraft(), "budget");
    expect(reopened).toMatchObject({ currentStep: "budget", completed: false });
    expect(reopened.settledSteps).not.toContain("budget");
    expect(settlePlanIntakeStep(reopened, { skip: true }).completed).toBe(true);
  });
});

describe("Plan intake area seed precedence", () => {
  it("prefers a live-position patch over a stale remembered patch", () => {
    expect(resolvePlanIntakeAreaSeed("shoreditch", { kind: "patch", id: "soho" }))
      .toEqual({ kind: "patch", id: "shoreditch" });
  });

  it("falls back to the remembered area when live position is unavailable", () => {
    expect(resolvePlanIntakeAreaSeed(null, { kind: "patch", id: "soho" }))
      .toEqual({ kind: "patch", id: "soho" });
  });

  it("only auto-seeds a blank intake draft", () => {
    expect(canSeedPlanIntakeArea(createPlanIntakeDraft())).toBe(true);
    expect(canSeedPlanIntakeArea(createPlanIntakeDraft({ kind: "patch", id: "soho" }))).toBe(false);
    expect(canSeedPlanIntakeArea(settlePlanIntakeStep(createPlanIntakeDraft(), { skip: true }))).toBe(false);
  });
});

describe("bounded Plan intake persistence", () => {
  it("round-trips a canonical partial flow in a bounded envelope", () => {
    const storage = memoryStorage();
    const draft = settlePlanIntakeStep({
      ...createPlanIntakeDraft(),
      answers: { ...createPlanIntakeDraft().answers, area: "clapham" },
    });
    writePlanIntakeDraft(draft, storage, NOW);
    const raw = storage.getItem(PLAN_INTAKE_STORAGE_KEY);
    expect(raw).toContain('"storageVersion":1');
    expect(raw).toContain('"expiresAt":"2026-07-21T12:00:00.000Z"');
    expect(readPlanIntakeDraft(storage, NOW)).toEqual(draft);
  });

  it("expires abandoned details and removes the stale storage entry", () => {
    const storage = memoryStorage();
    writePlanIntakeDraft(answeredDraft(), storage, NOW);
    expect(readPlanIntakeDraft(storage, NOW + PLAN_INTAKE_DRAFT_TTL_MS + 1)).toBeNull();
    expect(storage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBeNull();
  });

  it("clears the full intake draft after successful Plan creation", () => {
    const storage = memoryStorage();
    writePlanIntakeDraft(answeredDraft(), storage, NOW);
    clearPlanIntakeDraft(storage);
    expect(storage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBeNull();
  });
});

describe("strict draft canonicalization", () => {
  it("clears skipped answers and canonicalizes currentStep to the first unsettled step", () => {
    const draft: PlanIntakeDraft = {
      ...createPlanIntakeDraft(),
      currentStep: "accessibility",
      settledSteps: ["area"],
      skippedSteps: ["area"],
      answers: { ...createPlanIntakeDraft().answers, area: "soho" },
    };
    expect(parsePlanIntakeDraft(storedEnvelope(draft), NOW)).toMatchObject({
      currentStep: "time-window",
      completed: false,
      answers: { area: null },
    });
  });

  it("rejects settled unskipped steps without a valid answer", () => {
    const draft: PlanIntakeDraft = {
      ...createPlanIntakeDraft(),
      currentStep: "time-window",
      settledSteps: ["area"],
      answers: { ...createPlanIntakeDraft().answers, area: null },
    };
    expect(parsePlanIntakeDraft(storedEnvelope(draft), NOW)).toBeNull();
  });

  it("rejects duplicate or unknown step states", () => {
    const envelope = JSON.parse(storedEnvelope(createPlanIntakeDraft())) as {
      draft: Record<string, unknown>;
    };
    envelope.draft.settledSteps = ["area", "area"];
    expect(parsePlanIntakeDraft(JSON.stringify(envelope), NOW)).toBeNull();
    envelope.draft.settledSteps = ["bogus"];
    expect(parsePlanIntakeDraft(JSON.stringify(envelope), NOW)).toBeNull();
  });

  it("accepts completed only for a consistent terminal draft", () => {
    const partial = createPlanIntakeDraft();
    expect(parsePlanIntakeDraft(storedEnvelope({ ...partial, completed: true }), NOW)).toBeNull();
    expect(parsePlanIntakeDraft(storedEnvelope({ ...answeredDraft(), completed: false }), NOW)).toBeNull();
    expect(parsePlanIntakeDraft(storedEnvelope(answeredDraft()), NOW)?.completed).toBe(true);
  });

  it("rejects malformed envelopes and overlong retention windows", () => {
    expect(parsePlanIntakeDraft(JSON.stringify({ version: 1 }), NOW)).toBeNull();
    const envelope = JSON.parse(storedEnvelope(createPlanIntakeDraft())) as {
      expiresAt: string;
    };
    envelope.expiresAt = new Date(NOW + PLAN_INTAKE_DRAFT_TTL_MS + 1).toISOString();
    expect(parsePlanIntakeDraft(JSON.stringify(envelope), NOW)).toBeNull();
  });
});

describe("Europe/London exact time", () => {
  it("uses the next future occurrence and rolls a passed late slot to tomorrow", () => {
    expect(nextLondonOccurrenceIso("late", new Date("2026-07-20T20:30:00.000Z")))
      .toBe("2026-07-20T21:00:00.000Z");
    expect(nextLondonOccurrenceIso("late", new Date("2026-07-20T21:30:00.000Z")))
      .toBe("2026-07-21T21:00:00.000Z");
  });

  it("uses the correct London offset across both DST transitions", () => {
    expect(nextLondonOccurrenceIso("after-work", new Date("2026-03-28T23:30:00.000Z")))
      .toBe("2026-03-29T16:30:00.000Z");
    expect(nextLondonOccurrenceIso("after-work", new Date("2026-10-24T23:30:00.000Z")))
      .toBe("2026-10-25T17:30:00.000Z");
  });

  it("rejects a spring DST gap and resolves the next ambiguous autumn occurrence", () => {
    expect(londonDateTimeInputToIso("2026-03-29T01:30")).toBeNull();
    expect(londonDateTimeInputToIso("2026-10-25T01:30", new Date("2026-10-25T00:45:00.000Z")))
      .toBe("2026-10-25T01:30:00.000Z");
    expect(londonDateTimeInputToIso("2026-10-25T01:30", new Date("2026-10-25T01:30:00.000Z")))
      .toBeNull();
    expect(londonDateTimeInputFromIso("2026-07-20T16:30:00.000Z")).toBe("2026-07-20T17:30");
  });

  it("revalidates a dated exact handoff as future without changing its occurrence", () => {
    expect(resolveFutureLondonStartIso(
      "2026-10-25T01:30",
      "2026-10-25T01:30:00.000Z",
      new Date("2026-10-25T01:29:59.000Z"),
    )).toBe("2026-10-25T01:30:00.000Z");
    expect(resolveFutureLondonStartIso(
      "2026-10-25T01:30",
      "2026-10-25T01:30:00.000Z",
      new Date("2026-10-25T01:30:00.000Z"),
    )).toBeNull();
  });
});

describe("the composer's default First pint", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    // Assigning undefined would store the string "undefined", not unset TZ.
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("is London wall time on a device that is not in London", () => {
    // 20:42 UTC is 21:42 BST. Built from the device clock, the default read
    // 21:00, which the London future check refuses, so Lock it in stayed
    // disabled for every evening user whose device is not on London time.
    process.env.TZ = "UTC";
    const now = new Date("2026-10-04T20:42:30.000Z");
    const value = defaultLondonStartInput(now);
    expect(value).toBe("2026-10-04T22:00");
    expect(resolveFutureLondonStartIso(value, null, now)).toBe("2026-10-04T21:00:00.000Z");
  });

  it("reads the same on a London device", () => {
    process.env.TZ = "Europe/London";
    expect(defaultLondonStartInput(new Date("2026-10-04T20:42:30.000Z"))).toBe("2026-10-04T22:00");
  });

  it("moves to tomorrow at 19:00 London from 22:30, never a first pint near midnight", () => {
    process.env.TZ = "America/Los_Angeles";
    // 21:29 UTC is 22:29 BST: still tonight.
    expect(defaultLondonStartInput(new Date("2026-10-15T21:29:00.000Z"))).toBe("2026-10-15T22:45");
    // 21:30 UTC is 22:30 BST.
    expect(defaultLondonStartInput(new Date("2026-10-15T21:30:00.000Z"))).toBe("2026-10-16T19:00");
    // 22:30 UTC is 23:30 BST: the sprint saw a 23:45 default here.
    const late = new Date("2026-10-15T22:30:00.000Z");
    const value = defaultLondonStartInput(late);
    expect(value).toBe("2026-10-16T19:00");
    expect(resolveFutureLondonStartIso(value, null, late)).toBe("2026-10-16T18:00:00.000Z");
    // Across the month and the year, in GMT.
    expect(defaultLondonStartInput(new Date("2026-12-31T23:10:00.000Z"))).toBe("2027-01-01T19:00");
  });

  // Stepping over tonight may never be silent: the composer shows this slot
  // beside the field, with its date, so nobody loses the night they are
  // standing in (captain, 16 Oct 2026).
  it("offers tonight's next slot only once the default has stepped over tonight", () => {
    process.env.TZ = "America/Los_Angeles";
    // 21:29 UTC is 22:29 BST: the default IS tonight, so there is nothing to offer.
    expect(tonightLondonStartInput(new Date("2026-10-15T21:29:00.000Z"))).toBeNull();
    // 21:30 UTC is 22:30 BST: the default stepped over tonight.
    const cutoff = new Date("2026-10-15T21:30:00.000Z");
    expect(defaultLondonStartInput(cutoff)).toBe("2026-10-16T19:00");
    const tonight = tonightLondonStartInput(cutoff);
    expect(tonight).toBe("2026-10-15T22:45");
    expect(resolveFutureLondonStartIso(tonight!, null, cutoff)).toBe("2026-10-15T21:45:00.000Z");
  });

  // The night runs to 05:00 (`londonNightsAhead`), so the late window does too:
  // at 01:00 the default used to drop to 18:00 that evening while the composer
  // read the field as a LATER night, and the one-tap way back was absent for
  // the whole window.
  it("holds the late window from 22:30 right through the early hours", () => {
    process.env.TZ = "America/Los_Angeles";
    const cases = [
      // 22:00 UTC is 23:00 BST on the 15th.
      { now: "2026-10-15T22:00:00.000Z", tonight: "2026-10-15T23:15" },
      // 23:30 UTC is 00:30 BST on the 16th: still the 15th's night out.
      { now: "2026-10-15T23:30:00.000Z", tonight: "2026-10-16T00:45" },
      // 03:30 UTC is 04:30 BST on the 16th: the last of it.
      { now: "2026-10-16T03:30:00.000Z", tonight: "2026-10-16T04:45" },
    ];
    for (const { now, tonight } of cases) {
      const at = new Date(now);
      // The default is the evening AFTER the night running now, which at 00:30
      // and 04:30 is the same calendar day rather than the next one.
      expect(defaultLondonStartInput(at), now).toBe("2026-10-16T19:00");
      expect(londonNightsAhead(defaultLondonStartInput(at), at), now)
        .toMatchObject({ nights: 1 });
      // And the one-tap way back is on the night the reader is standing in.
      expect(tonightLondonStartInput(at), now).toBe(tonight);
      expect(londonNightsAhead(tonight, at), now).toMatchObject({ nights: 0, past: false });
      expect(resolveFutureLondonStartIso(tonight, null, at), now).not.toBeNull();
    }
  });

  // The slot must stay on the night the door NAMES. The quarter-hour rounding
  // walks off the end of the night from 04:31, and the words on the door said
  // "Tonight" over a start the heading then called tomorrow night.
  it("offers nothing once the rounding has left the night it would name", () => {
    process.env.TZ = "America/Los_Angeles";
    // 03:30 UTC is 04:30 BST: the last slot still on this night.
    const inTime = new Date("2026-10-16T03:30:00.000Z");
    expect(tonightLondonStartInput(inTime)).toBe("2026-10-16T04:45");
    // 03:40 UTC is 04:40 BST: the next quarter is 05:00, which is the NEXT
    // night by the product's own rule, so there is no tonight slot left.
    const tooLate = new Date("2026-10-16T03:40:00.000Z");
    expect(londonNightsAhead("2026-10-16T05:00", tooLate)).toMatchObject({ nights: 1 });
    expect(tonightLondonStartInput(tooLate)).toBeNull();
  });

  // The spring-forward gap sits inside the late window, and a start inside it
  // is a time the lock refuses: offering it re-opened a settled intake step.
  it("offers nothing when the slot would land in the hour the clocks skip", () => {
    process.env.TZ = "America/Los_Angeles";
    // 00:50 London on 29 Mar 2026; the next quarter is 01:15, which does not
    // happen that night because the clocks go straight to 02:00.
    const beforeTheGap = new Date("2026-03-29T00:50:00.000Z");
    expect(londonDateTimeInputToIso("2026-03-29T01:15")).toBeNull();
    expect(tonightLondonStartInput(beforeTheGap)).toBeNull();
    // Once the clocks have moved, the window answers again.
    const afterTheGap = new Date("2026-03-29T01:30:00.000Z");
    expect(tonightLondonStartInput(afterTheGap)).toBe("2026-03-29T02:45");
  });

  it("closes the late window once the night has ended", () => {
    process.env.TZ = "America/Los_Angeles";
    // 04:00 UTC is 05:00 BST: the night is over, the default is this evening
    // and there is nothing to step back to.
    const morning = new Date("2026-10-16T04:00:00.000Z");
    expect(tonightLondonStartInput(morning)).toBeNull();
    expect(defaultLondonStartInput(morning)).toBe("2026-10-16T18:00");
    expect(londonNightsAhead(defaultLondonStartInput(morning), morning))
      .toMatchObject({ nights: 0 });
  });

  it("keeps an early-hours slot on the night that is running, and locks it", () => {
    process.env.TZ = "America/Los_Angeles";
    // 22:50 UTC is 23:50 BST: the next quarter is past midnight by the clock
    // and still the same night out, which is why the choice carries its date.
    const late = new Date("2026-10-15T22:50:00.000Z");
    const tonight = tonightLondonStartInput(late);
    expect(tonight).toBe("2026-10-16T00:15");
    expect(londonNightsAhead(tonight!, late)).toMatchObject({ nights: 0, past: false });
    expect(resolveFutureLondonStartIso(tonight!, null, late)).toBe("2026-10-15T23:15:00.000Z");
    // And the default it stands beside is a night ahead of it.
    expect(londonNightsAhead(defaultLondonStartInput(late), late)).toMatchObject({ nights: 1 });
  });

  it("starts an afternoon plan at 18:00 London, in summer and in winter", () => {
    process.env.TZ = "America/New_York";
    expect(defaultLondonStartInput(new Date("2026-07-20T09:05:00.000Z"))).toBe("2026-07-20T18:00");
    expect(defaultLondonStartInput(new Date("2026-12-01T15:30:00.000Z"))).toBe("2026-12-01T18:00");
  });

  it("rounds a quarter hour ahead after 17:00 London", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(defaultLondonStartInput(new Date("2026-12-01T17:00:00.000Z"))).toBe("2026-12-01T17:15");
    expect(defaultLondonStartInput(new Date("2026-12-01T17:01:00.000Z"))).toBe("2026-12-01T17:30");
  });

  // Runs last: vitest reuses its workers, so a zone left behind here would put
  // every later date test in this process on the last zone above.
  it("leaves the process zone as it found it", () => {
    expect("TZ" in process.env).toBe(originalTz !== undefined);
    expect(process.env.TZ).toBe(originalTz);
  });
});

describe("Wave 2.2 typed handoff and stale constraint retraction", () => {
  const generatedContext: NightContext = {
    nightArea: "bermondsey-london-bridge",
    daypart: "after_work",
    partyType: "friends",
    groupSize: 5,
    budget: "value",
    budgetLimitPence: 2500,
    zeroProof: true,
    wetherspoonsPreferred: false,
    atmosphere: ["quiet"],
    foodNeeds: ["vegan"],
    accessibility: ["step-free", "accessible-toilet"],
    transportConstraints: ["tube"],
  };

  it("preserves exact dated time, ceiling and accessibility constraints", () => {
    const draft = answeredDraft();
    expect(planIntakeHandoff(draft)).toEqual({
      version: 1,
      area: { kind: "night-patch", id: "london-bridge" },
      timeWindow: {
        id: "after-work",
        start: "17:30",
        end: "20:30",
        exactStartIso: "2026-07-20T16:30:00.000Z",
      },
      groupSize: 5,
      budget: { tier: "value", limitPence: 2500 },
      accessibilityNeeds: ["step-free", "accessible-toilet"],
      skipped: [],
    });
    expect(planIntakeNightContextPatch(draft)).toEqual({
      nightArea: "bermondsey-london-bridge",
      daypart: "after_work",
      groupSize: 5,
      budget: "value",
      budgetLimitPence: 2500,
      accessibility: ["step-free", "accessible-toilet"],
    });
  });

  const ownedFields: Record<PlanIntakeStep, Array<keyof NightContext>> = {
    area: ["nightArea"],
    "time-window": ["daypart"],
    "group-size": ["groupSize"],
    budget: ["budget", "budgetLimitPence"],
    accessibility: ["accessibility"],
  };

  for (const step of PLAN_INTAKE_STEPS) {
    it(`removes stale ${step} fields after answer, generate, reopen and skip`, () => {
      const skipped = settlePlanIntakeStep(reopenPlanIntakeStep(answeredDraft(), step), { skip: true });
      const body = buildPlanGenerationIntakeBody(skipped, "", generatedContext);
      for (const field of ownedFields[step]) {
        expect(body.context).not.toHaveProperty(field);
      }
      expect(body.intake.skipped).toContain(step);
    });
  }

  it("preserves non-intake inferred context and explicit post-generation edits", () => {
    const skippedArea = settlePlanIntakeStep(
      reopenPlanIntakeStep(answeredDraft(), "area"),
      { skip: true },
    );
    const body = buildPlanGenerationIntakeBody(
      skippedArea,
      "",
      generatedContext,
      { nightArea: "victoria" },
    );
    expect(body.context).toMatchObject({
      nightArea: "victoria",
      partyType: "friends",
      zeroProof: true,
      wetherspoonsPreferred: false,
      atmosphere: ["quiet"],
      foodNeeds: ["vegan"],
      transportConstraints: ["tube"],
    });
  });

  it("retracts removed walking text while preserving recovered drink and food choices", () => {
    const body = buildPlanGenerationIntakeBody(
      answeredDraft(),
      "Three pubs in Clapham with listed pint prices.",
      { ...generatedContext, transportConstraints: ["walking"] },
    );
    expect(body.context).toMatchObject({
      zeroProof: true,
      atmosphere: ["quiet"],
      foodNeeds: ["vegan"],
      transportConstraints: [],
    });
  });

  it("threads an exact accepted Venue anchor through generation intake", () => {
    const anchor = {
      venueId: "venue-intent",
      source: "near" as const,
      cityId: "manchester" as const,
      acceptedArea: { kind: "night-patch" as const, id: "soho" as const },
      startsAt: "2026-07-24T20:00:00.000Z",
    };
    const body = buildPlanGenerationIntakeBody(
      answeredDraft(),
      "quiet pints",
      generatedContext,
      {},
      anchor,
    );

    expect(body.cityId).toBe("manchester");
    expect(body.anchor).toEqual({
      venueId: anchor.venueId,
      source: anchor.source,
      acceptedArea: anchor.acceptedArea,
      startsAt: anchor.startsAt,
    });
    expect(Object.keys(body.anchor ?? {})).toEqual([
      "venueId", "source", "acceptedArea", "startsAt",
    ]);
  });

  it("omits anchor from generic generation intake bodies", () => {
    const body = buildPlanGenerationIntakeBody(answeredDraft(), "", generatedContext);
    expect(body).not.toHaveProperty("anchor");
  });

  it("drops a seeded area from skipped so describe-first after Keep is consistent", () => {
    const seeded = createPlanIntakeDraft({ kind: "patch", id: "clapham" });
    const conflicting: PlanIntakeDraft = {
      ...seeded,
      skippedSteps: ["area", "time-window", "group-size", "budget", "accessibility"],
      settledSteps: [...PLAN_INTAKE_STEPS],
      completed: true,
    };
    const body = buildPlanGenerationIntakeBody(conflicting, "quiet in Clapham", null);
    expect(body.intake.area).toEqual({ kind: "night-patch", id: "clapham" });
    expect(body.intake.skipped).not.toContain("area");
  });

  it("does not silently coerce Hackney into a different generation area", () => {
    const draft = createPlanIntakeDraft({ kind: "patch", id: "hackney" });
    expect(planIntakeHandoff(draft).area).toEqual({ kind: "night-patch", id: "hackney" });
    expect(planIntakeNightContextPatch(draft)).not.toHaveProperty("nightArea");
  });
});

describe("intake accessibility and entry invariants", () => {
  it("renders standalone entry controls without a router provider", () => {
    const html = renderToStaticMarkup(createElement(PlanIntake, {
      draft: createPlanIntakeDraft(),
      onChange: () => undefined,
    }));
    expect(html).toContain("Shape the route");
    expect(html).toContain("Describe instead");
    expect(html).toContain('href="/pal/chat"');
  });
});
