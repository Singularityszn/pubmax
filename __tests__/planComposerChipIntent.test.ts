// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));

import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

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

  it("clears a geo-seeded area when submitted text names an unsupported area", () => {
    const draft = createPlanIntakeDraft({ kind: "patch", id: "clapham" });
    const synced = syncPlanIntakeAreaFromQuery(draft, "Canary Wharf after work");
    expect(synced.answers.area).toBeNull();
    expect(synced.skippedSteps).toContain("area");
    const resynced = syncPlanIntakeAreaFromQuery(synced, "Camden crawl tonight");
    expect(resynced.answers.area).toBe("camden");
    expect(resynced.skippedSteps).not.toContain("area");
  });

  it("preserves explicit people selection when concierge infers a route", () => {
    const explicit: NightContext = {
      nightArea: "camden",
      daypart: "evening",
      partyType: "friends",
      groupSize: 6,
      stopCount: 3,
      budget: "standard",
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

  it("preserves an explicit stop count when generated route length differs", () => {
    const explicit: NightContext = {
      nightArea: "camden",
      daypart: "evening",
      partyType: "friends",
      groupSize: 4,
      stopCount: 4,
      budget: "standard",
      budgetLimitPence: null,
      zeroProof: false,
      wetherspoonsPreferred: false,
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
    };
    const inferred: NightContext = { ...explicit, stopCount: 3 };
    const reconciled = reconcileGeneratedNightContext(inferred, explicit, 3);
    expect(reconciled.stopCount).toBe(4);
  });

  it("uses generated route length when no stop count was selected", () => {
    const inferred: NightContext = {
      nightArea: "camden",
      daypart: "evening",
      partyType: "friends",
      groupSize: 4,
      stopCount: 3,
      budget: "standard",
      budgetLimitPence: null,
      zeroProof: false,
      wetherspoonsPreferred: false,
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
    };
    const reconciled = reconcileGeneratedNightContext(inferred, {}, 4);
    expect(reconciled.stopCount).toBe(4);
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

describe("PlanDescribeFirst chip intent", () => {
  it("keeps a selected stop count when typing before tapping a chip", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(createElement(PlanDescribeFirst, {
        onSubmit,
        onGuideMeInstead: vi.fn(),
      }));
    });

    const stopCount = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "6");
    await act(async () => {
      stopCount?.click();
    });

    const query = container.querySelector<HTMLInputElement>("#plan-describe-first-query");
    if (!query) throw new Error("describe-first query did not render");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(query, "Camden");
    const chip = container.querySelector<HTMLButtonElement>(".planDescribeFirst__chip--culture");
    await act(async () => {
      query.dispatchEvent(new Event("input", { bubbles: true }));
      chip?.click();
    });

    expect(onSubmit).toHaveBeenCalledWith("Camden", 6);
  });

  it("reports typed query text to the composer before leaving describe-first", async () => {
    const onQueryChange = vi.fn();
    await act(async () => {
      root.render(createElement(PlanDescribeFirst, {
        onSubmit: vi.fn(),
        onGuideMeInstead: vi.fn(),
        onQueryChange,
      }));
    });

    const query = container.querySelector<HTMLInputElement>("#plan-describe-first-query");
    if (!query) throw new Error("describe-first query did not render");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(query, "Camden");
    await act(async () => {
      query.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onQueryChange).toHaveBeenLastCalledWith("Camden");
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
