import { describe, expect, it } from "vitest";
import { parsePlanDraft, readPlanDraftEnvelope, writePlanDraftEnvelope } from "@/lib/planDraft";
import { createPlanIntakeDraft, parsePlanIntakeDraftWithMetadata, planIntakeHandoff, readPlanIntakeDraftWithMetadata, writePlanIntakeDraft } from "@/lib/planIntake";
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
