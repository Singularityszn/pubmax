// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlanIntakeDraft } from "@/lib/planIntake";
import {
  composerGeolocationMaySeedIntake,
  fillEmptyText,
  mergeInferredNightContext,
  mergeSubmittedNightContext,
  mergePlanTemplateFields,
  nightAreaFromPlanQuery,
  reconcileGeneratedNightContext,
  syncPlanIntakeAreaFromQuery,
} from "@/lib/planComposerChipFill";
import { inferNightContext, type NightContext } from "@/lib/nightPlanning";

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
  it.each([
    { query: "Camden", count: undefined },
    { query: "Plan a crawl in Camden", count: undefined },
    { query: "Camden 6 pubs", count: 6 },
  ])("keeps $query when a chip is tapped and submits only on request", async ({ query, count }) => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(createElement(PlanDescribeFirst, { initialQuery: query, onSubmit, onGuideMeInstead: vi.fn() }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>(".planDescribeFirst__chip--culture")!.click());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>("#plan-describe-first-query")?.value).toBe(query);
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Plan it")!.click());
    expect(onSubmit).toHaveBeenLastCalledWith(query, count);
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

  it("uses submitted intake area over stale context area", () => {
    const submitted = mergeSubmittedNightContext(
      { nightArea: "chiswick", groupSize: 6 },
      { nightArea: "camden", stopCount: 4 },
    );
    expect(submitted.nightArea).toBe("camden");
    expect(submitted.groupSize).toBe(6);
    expect(submitted.stopCount).toBe(4);
  });

  it.each([
    { query: "Soho", submittedFocus: null, expected: "soho" },
    { query: "Piccadilly", submittedFocus: "soho" as const, expected: "piccadilly" },
    { query: "Piccadilly and Soho", submittedFocus: "soho" as const, expected: undefined },
    { query: "Camden", submittedFocus: "soho" as const, expected: undefined },
  ])("keeps the server geography for $query over submitted focus $submittedFocus", ({ query, submittedFocus, expected }) => {
    const generated = inferNightContext(query).context;
    const reconciled = reconcileGeneratedNightContext(generated, {
      nightArea: "piccadilly-soho",
      areaFocus: submittedFocus,
      groupSize: 6,
    }, 3);
    expect(reconciled.nightArea).toBe("piccadilly-soho");
    expect(reconciled.areaFocus).toBe(expected);
    expect(reconciled.groupSize).toBe(6);
  });

  it("keeps an unmapped recognized query area over stale context area", () => {
    const queryArea = nightAreaFromPlanQuery("Canary Wharf after work");
    expect(queryArea).toEqual({ kind: "unmapped", slug: "canary-wharf" });
    const submitted = mergeSubmittedNightContext(
      { nightArea: "chiswick" },
      {},
      queryArea,
    );
    expect(submitted.nightArea).toBe("canary-wharf");
  });

  it("clears stale area authority for an unsupported night patch", () => {
    const draft = createPlanIntakeDraft({ kind: "patch", id: "clapham" });
    const queryArea = nightAreaFromPlanQuery("Hackney crawl tonight");
    expect(queryArea).toEqual({ kind: "unsupported-patch", patchId: "hackney" });
    const synced = syncPlanIntakeAreaFromQuery(draft, "Hackney crawl tonight");
    expect(synced.answers.area).toBeNull();
    const submitted = mergeSubmittedNightContext({ nightArea: "clapham" }, {}, queryArea);
    expect(submitted.nightArea).toBeNull();
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
        id: "test-template",
        label: "Test template",
        title: "Chip title",
        conciergeQuery: "Quiet in Clapham",
        blurb: "Chip note",
      },
      hasAcceptedGeography: false,
    });
    expect(merged.title).toBe("My night");
    expect(merged.conciergeQuery).toBe("Quiet in Clapham");
    expect(merged.conciergeNote).toBe("Already here");
  });

  it("does not fill template geography over selected geography", () => {
    const merged = mergePlanTemplateFields({
      title: "",
      conciergeQuery: "",
      conciergeNote: "",
      template: {
        id: "test-template",
        label: "Test template",
        title: "Chip title",
        conciergeQuery: "Quiet in Clapham",
        blurb: "Chip note",
      },
      hasAcceptedGeography: true,
    });
    expect(merged.conciergeQuery).toBe("Quiet");
  });
});

describe("PlanDescribeFirst chip intent", () => {
  it("keeps typed text and waits for explicit submit when tapping a chip", async () => {
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

    expect(onSubmit).not.toHaveBeenCalled();
    expect(query.value).toBe("Camden");
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

  it("reports an adopted prefill to the composer before leaving describe-first", async () => {
    const onPrefillQueryChange = vi.fn();
    await act(async () => {
      root.render(createElement(PlanDescribeFirst, {
        initialQuery: "Camden",
        onSubmit: vi.fn(),
        onGuideMeInstead: vi.fn(),
        onPrefillQueryChange,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onPrefillQueryChange).toHaveBeenLastCalledWith("Camden");
  });

  it("syncs every describe-first keystroke to the composer", async () => {
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
    for (const value of ["C", "Ca", "Cam", "Camden"]) {
      setter?.call(query, value);
      await act(async () => {
        query.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(onQueryChange).toHaveBeenLastCalledWith(value);
    }
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
