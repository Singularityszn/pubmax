import { describe, expect, it } from "vitest";
import { parsePlanDraft, readPlanDraftEnvelope, writePlanDraftEnvelope } from "@/lib/planDraft";
import { createPlanIntakeDraft, parsePlanIntakeDraftWithMetadata, planIntakeHandoff, readPlanIntakeDraftWithMetadata, settlePlanIntakeStep, writePlanIntakeDraft } from "@/lib/planIntake";
import { recoverPlanDrafts } from "@/lib/planDraftArbitration";
import type { NightContext } from "@/lib/nightPlanning";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const DRAFT = { title: "Night", creatorName: "Captain", startTime: "", conciergeQuery: "Clapham tonight", stops: [{ key: 1, venueId: "pub-a", venueName: "Pub A" }], routeReference: null };
function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); }, key: (index) => [...values.keys()][index] ?? null,
  };
}

const validInputs: Partial<NightContext>[] = [
  {}, { partyType: "work", daypart: "daytime" }, { daypart: "get_home" },
  { nightArea: null, drinkCategory: null, zeroProof: false, groupSize: null, budgetLimitPence: null },
  { stopCount: 5, zeroProof: true, accessibility: ["step-free"] },
];

describe("request input metadata storage contract", () => {
  it.each(validInputs)("round trips explicit choices and clears without adding them to the intake API: %j", (explicitNightContext) => {
    const session = storage();
    const local = storage();
    expect(writePlanDraftEnvelope({ ...DRAFT, explicitNightContext }, "manual", session, NOW)).toMatchObject({ v1: true, v2: true });
    expect(writePlanIntakeDraft(createPlanIntakeDraft(), local, NOW, null, explicitNightContext)).toBe(true);
    expect(readPlanDraftEnvelope(session, NOW)?.draft.explicitNightContext).toEqual(explicitNightContext);
    expect(parsePlanDraft(session.getItem("pubmaxx:plan-draft:v1"), NOW)?.explicitNightContext).toEqual(explicitNightContext);
    const intake = readPlanIntakeDraftWithMetadata(local, NOW)!;
    expect(intake.explicitNightContext).toEqual(explicitNightContext);
    expect(planIntakeHandoff(intake.draft)).not.toHaveProperty("explicitNightContext");
  });

  it.each([undefined, null, [], "work", { unknown: true }, { zeroProof: "true" }, { daypart: "never" }, { stopCount: 99 }, { zeroProof: true, partyType: "invalid" }])(
    "keeps malformed or missing maps UNKNOWN without dropping editable records: %j", (explicitNightContext) => {
      const session = storage();
      const local = storage();
      writePlanDraftEnvelope(DRAFT, "manual", session, NOW);
      writePlanIntakeDraft(createPlanIntakeDraft(), local, NOW);
      const plan = JSON.parse(session.getItem("pubmax:plan-draft:v2")!);
      plan.draft.explicitNightContext = explicitNightContext;
      session.setItem("pubmax:plan-draft:v2", JSON.stringify(plan));
      const intake = JSON.parse(local.getItem("pubmax:plan-intake:v1")!);
      intake.explicitNightContext = explicitNightContext;
      expect(readPlanDraftEnvelope(session, NOW)?.draft).toMatchObject({ title: "Night", stops: [{ venueId: "pub-a" }] });
      expect(readPlanDraftEnvelope(session, NOW)?.draft).not.toHaveProperty("explicitNightContext");
      const parsed = parsePlanIntakeDraftWithMetadata(JSON.stringify(intake), NOW);
      expect(parsed?.draft).toEqual(createPlanIntakeDraft());
      expect(parsed).not.toHaveProperty("explicitNightContext");
    },
  );
});

it.each(["session", "intake", "equal", "conflict"] as const)("selects one whole input map with the %s request", (winner) => {
  const session = storage();
  const local = storage();
  const sessionTime = winner === "intake" ? NOW - 1000 : NOW;
  const intakeTime = winner === "session" || winner === "conflict" ? NOW - 1000 : NOW;
  writePlanDraftEnvelope({ ...DRAFT, explicitNightContext: { zeroProof: true } }, "manual", session, sessionTime);
  writePlanIntakeDraft(createPlanIntakeDraft(), local, intakeTime, null, { partyType: "work", groupSize: null });
  const plan = readPlanDraftEnvelope(session, NOW)!;
  const recovered = recoverPlanDrafts({
    plan, legacyDraft: winner === "conflict" ? { ...plan.draft, explicitNightContext: {} } : plan.draft,
    intake: readPlanIntakeDraftWithMetadata(local, NOW), route: null,
  });
  if (winner === "conflict") expect(recovered.intent).not.toHaveProperty("explicitNightContext");
  else expect(recovered.intent.explicitNightContext).toEqual(winner === "intake" ? { partyType: "work", groupSize: null } : { zeroProof: true });
  expect(recovered.intent.stopCount).toBeUndefined();
});

it("does not let conflicting input maps remove independent count authority", () => {
  const session = storage();
  writePlanDraftEnvelope({ ...DRAFT, requestedStopCount: 5, requestedStopCountSource: "picker", explicitNightContext: {} }, "manual", session, NOW);
  const plan = readPlanDraftEnvelope(session, NOW)!;
  const recovered = recoverPlanDrafts({ plan, legacyDraft: { ...plan.draft, explicitNightContext: { zeroProof: true } }, intake: null, route: null });
  expect(recovered.intent).toMatchObject({ stopCount: 5, stopCountSource: "picker", conciergeQuery: "Clapham tonight" });
  expect(recovered.intent).not.toHaveProperty("explicitNightContext");
});


it("restores actual wizard inputs from the winning Session request after a cosmetic edit", () => {
  const session = storage();
  const local = storage();
  const requestIntake = createPlanIntakeDraft();
  requestIntake.answers.groupSize = 6;
  requestIntake.answers.accessibilityNeeds = ["step-free"];
  writePlanIntakeDraft(requestIntake, local, NOW - 1000, null);
  writePlanDraftEnvelope({ ...DRAFT, requestIntake, explicitNightContext: { zeroProof: true } }, "manual", session, NOW);
  const plan = readPlanDraftEnvelope(session, NOW)!;
  const recovered = recoverPlanDrafts({ plan, legacyDraft: parsePlanDraft(session.getItem("pubmaxx:plan-draft:v1"), NOW),
    intake: readPlanIntakeDraftWithMetadata(local, NOW), route: null });
  expect(recovered.intakeDraft).toMatchObject({ savedAt: new Date(NOW).toISOString(), draft: {
    answers: { groupSize: 6, accessibilityNeeds: ["step-free"] },
  } });
  expect(recovered.intent.explicitNightContext).toEqual({ zeroProof: true });
});

it("keeps a fresh Ask's empty actual inputs separate from older wizard constraints", () => {
  const session = storage();
  const local = storage();
  const old = createPlanIntakeDraft();
  old.answers.groupSize = 6;
  old.answers.accessibilityNeeds = ["step-free"];
  writePlanIntakeDraft(old, local, NOW - 1000, null);
  writePlanDraftEnvelope({ ...DRAFT, conciergeQuery: "Clapham tonight, a treat night",
    requestIntake: createPlanIntakeDraft(), explicitNightContext: {} }, "manual", session, NOW);
  const plan = readPlanDraftEnvelope(session, NOW)!;
  const recovered = recoverPlanDrafts({ plan, legacyDraft: plan.draft,
    intake: readPlanIntakeDraftWithMetadata(local, NOW), route: null });
  expect(recovered.intakeDraft?.draft.answers).toMatchObject({ groupSize: null, accessibilityNeeds: [], budget: null });
  expect(recovered.intent.explicitNightContext).toEqual({});
});

it.each([null, [], "six", { version: 99 }, { ...createPlanIntakeDraft(), answers: { stopCount: 99 } }])(
  "ignores invalid optional actual intake metadata without losing a valid route: %j", (requestIntake) => {
    const session = storage();
    writePlanDraftEnvelope(DRAFT, "manual", session, NOW);
    const envelope = JSON.parse(session.getItem("pubmax:plan-draft:v2")!);
    envelope.draft.requestIntake = requestIntake;
    session.setItem("pubmax:plan-draft:v2", JSON.stringify(envelope));
    expect(readPlanDraftEnvelope(session, NOW)?.draft).toMatchObject({ stops: [{ venueId: "pub-a" }] });
    expect(readPlanDraftEnvelope(session, NOW)?.draft).not.toHaveProperty("requestIntake");
  },
);


it.each(["v1", "v2"] as const)("does not borrow conflicting actual inputs after only %s saves a request edit", (format) => {
  const session = storage();
  const local = storage();
  const original = createPlanIntakeDraft();
  original.answers.groupSize = 6;
  const edited = createPlanIntakeDraft();
  edited.answers.groupSize = 2;
  writePlanIntakeDraft(original, local, NOW - 1000, null, {});
  writePlanDraftEnvelope({ ...DRAFT, requestIntake: original, explicitNightContext: {} }, "manual", session, NOW - 1000);
  const blockedKey = format === "v1" ? "pubmax:plan-draft:v2" : "pubmaxx:plan-draft:v1";
  const partiallyWritable = { getItem: session.getItem.bind(session), setItem: (key: string, value: string) => {
    if (key === blockedKey) throw new Error("Storage full");
    session.setItem(key, value);
  } };
  writePlanDraftEnvelope({ ...DRAFT, requestIntake: edited, explicitNightContext: {} }, "manual", partiallyWritable, NOW);
  const plan = readPlanDraftEnvelope(session, NOW)!;
  const recovered = recoverPlanDrafts({ plan,
    legacyDraft: parsePlanDraft(session.getItem("pubmaxx:plan-draft:v1"), NOW),
    intake: readPlanIntakeDraftWithMetadata(local, NOW), route: null });
  expect(recovered.intakeDraft).toBeNull();
  expect(readPlanDraftEnvelope(session, NOW)?.draft.requestIntake?.answers.groupSize).toBe(format === "v2" ? 2 : 6);
  expect(parsePlanDraft(session.getItem("pubmaxx:plan-draft:v1"), NOW)?.requestIntake?.answers.groupSize).toBe(format === "v1" ? 2 : 6);
  expect(readPlanIntakeDraftWithMetadata(local, NOW)?.draft.answers.groupSize).toBe(6);
});

it.each(["v1", "v2"])("restores an explicitly skipped wizard step from %s without restoring its answer", (format) => {
  const session = storage();
  const intake = createPlanIntakeDraft();
  intake.answers.area = "clapham";
  const skipped = settlePlanIntakeStep(intake, { skip: true });
  writePlanDraftEnvelope({ ...DRAFT, requestIntake: skipped }, "manual", session, NOW);
  if (format === "v1") session.removeItem("pubmax:plan-draft:v2");
  const plan = readPlanDraftEnvelope(session, NOW)!;
  const recovered = recoverPlanDrafts({ plan, legacyDraft: parsePlanDraft(session.getItem("pubmaxx:plan-draft:v1"), NOW), intake: null, route: null });
  expect(recovered.requestIntake).toEqual(skipped);
  expect(recovered.requestIntake?.answers.area).toBeNull();
  expect(recovered.requestIntake?.skippedSteps).toEqual(["area"]);
  expect(recovered.requestIntake?.currentStep).toBe("time-window");
  if (format === "v1") {
    expect(plan).toMatchObject({ savedAt: null, expiresAt: null, legacy: true });
    expect(recovered.intakeDraft).toBeNull();
    expect(recovered.recoveredDraft?.routeReference).toBeNull();
    expect(recovered.intent.stopCount).toBeUndefined();
  }
});

it.each(["v1", "v2"])("rejects invalid wizard lifecycle from %s while retaining its valid route preview", (format) => {
  const session = storage();
  writePlanDraftEnvelope(DRAFT, "manual", session, NOW);
  const key = format === "v1" ? "pubmaxx:plan-draft:v1" : "pubmax:plan-draft:v2";
  const record = JSON.parse(session.getItem(key)!);
  const draft = format === "v1" ? record : record.draft;
  draft.requestIntake = { ...createPlanIntakeDraft(), completed: true };
  session.setItem(key, JSON.stringify(record));
  session.removeItem(format === "v1" ? "pubmax:plan-draft:v2" : "pubmaxx:plan-draft:v1");
  const plan = readPlanDraftEnvelope(session, NOW)!;
  const recovered = recoverPlanDrafts({ plan, legacyDraft: parsePlanDraft(session.getItem("pubmaxx:plan-draft:v1"), NOW), intake: null, route: null });
  expect(recovered.requestIntake).toBeNull();
  expect(recovered.recoveredDraft?.stops).toEqual([{ key: 1, venueId: "pub-a", venueName: "Pub A" }]);
});
