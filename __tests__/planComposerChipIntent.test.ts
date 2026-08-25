import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPlanIntakeDraft } from "@/lib/planIntake";
import {
  composerGeolocationMaySeedIntake,
  fillEmptyText,
  mergeInferredNightContext,
  mergePlanTemplateFields,
  reconcileGeneratedNightContext,
  resolveDescribeChipSubmit,
  syncPlanIntakeAreaFromQuery,
} from "@/lib/planComposerChipFill";
import type { NightContext } from "@/lib/nightPlanning";

const ROOT = join(__dirname, "..");

function readSource(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("plan composer chip intent policy", () => {
  it("keeps typed Camden when a describe chip is tapped", () => {
    const result = resolveDescribeChipSubmit({
      touched: true,
      query: "Camden",
      stopCountTouched: false,
      stopCount: 3,
      chipText: "Quiet in Clapham for 4, not pricey",
      chipInferredStopCount: 3,
    });
    expect(result.query).toBe("Camden");
    expect(result.stopCount).toBe(3);
  });

  it("submits submitted query area over a geo-seeded intake patch", () => {
    const draft = createPlanIntakeDraft({ kind: "patch", id: "clapham" });
    const synced = syncPlanIntakeAreaFromQuery(draft, "Camden crawl tonight");
    expect(synced.answers.area).toBe("camden");
  });

  it("preserves explicit people selection when concierge infers a route", () => {
    const explicit: NightContext = {
      nightArea: "camden",
      daypart: "evening",
      partyType: "friends",
      groupSize: 6,
      stopCount: 3,
      budget: "mid",
      budgetLimitPence: null,
      zeroProof: false,
      wetherspoonsPreferred: false,
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
    };
    const inferred: NightContext = {
      ...explicit,
      groupSize: 2,
      nightArea: "chiswick",
    };
    const merged = mergeInferredNightContext(inferred, explicit);
    expect(merged.groupSize).toBe(6);
    expect(merged.nightArea).toBe("camden");

    const reconciled = reconcileGeneratedNightContext(inferred, explicit, 3);
    expect(reconciled.groupSize).toBe(6);
    expect(reconciled.stopCount).toBe(3);
  });

  it("aligns stop count with a generated route so lock can enable", () => {
    const explicit: NightContext = {
      nightArea: "camden",
      daypart: "evening",
      partyType: "friends",
      groupSize: 4,
      stopCount: 2,
      budget: "mid",
      budgetLimitPence: null,
      zeroProof: false,
      wetherspoonsPreferred: false,
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
    };
    const inferred: NightContext = { ...explicit, stopCount: 2 };
    const reconciled = reconcileGeneratedNightContext(inferred, explicit, 3);
    expect(reconciled.stopCount).toBe(3);
  });

  it("fills template chips into empty fields only", () => {
    const merged = mergePlanTemplateFields({
      title: "My night",
      conciergeQuery: "",
      conciergeNote: "Already here",
      template: {
        title: "Chip title",
        conciergeQuery: "Quiet in Clapham",
        conciergeNote: "Chip note",
      },
      hasAcceptedGeography: false,
    });
    expect(merged.title).toBe("My night");
    expect(merged.conciergeQuery).toBe("Quiet in Clapham");
    expect(merged.conciergeNote).toBe("Already here");
  });
});

describe("plan composer chip intent source fences", () => {
  it("PlanDescribeFirst resolves chip submit through the shared policy", () => {
    const source = readSource("components/plan/PlanDescribeFirst.tsx");
    expect(source).toContain("resolveDescribeChipSubmit");
    expect(source).toContain("stopCountTouched");
  });

  it("PlanComposer blocks geo seed on describe-first and syncs area from submitted query", () => {
    const source = readSource("components/plan/PlanComposer.tsx");
    expect(source).toContain("composerGeolocationMaySeedIntake");
    expect(source).toContain("syncPlanIntakeAreaFromQuery");
    expect(source).toContain("reconcileGeneratedNightContext");
    expect(source).toContain("mergePlanTemplateFields");
  });

  it("geo seed guard refuses describe-first with live query text", () => {
    expect(
      composerGeolocationMaySeedIntake({ showsDescribeFirst: true, hasQueryText: true }),
    ).toBe(false);
  });

  it("fillEmptyText never overwrites non-empty user text", () => {
    expect(fillEmptyText("Camden", "Quiet in Clapham")).toBe("Camden");
  });
});
