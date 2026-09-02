// @vitest-environment jsdom

import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MobilePlanActivation } from "@/components/plan/MobilePlanActivation";
import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import PlanIntake from "@/components/plan/PlanIntake";
import WantedCapture from "@/components/wanted/WantedCapture";
import { createPlanIntakeDraft, type PlanIntakeDraft } from "@/lib/planIntake";

function intakeDraft(
  currentStep: PlanIntakeDraft["currentStep"],
  answers: Partial<PlanIntakeDraft["answers"]> = {},
): PlanIntakeDraft {
  const draft = createPlanIntakeDraft();
  return {
    ...draft,
    currentStep,
    answers: { ...draft.answers, ...answers },
  };
}

function renderedInputs(): HTMLInputElement[] {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(PlanDescribeFirst, {
        onSubmit: () => undefined,
        onGuideMeInstead: () => undefined,
      }),
      createElement(MobilePlanActivation, {
        cityId: "london",
        initialNightArea: "clapham",
        onGenerated: () => undefined,
      }),
      createElement(PlanIntake, {
        draft: intakeDraft("time-window", {
          timeWindow: "evening",
          exactStartIso: "2026-07-20T18:00:00.000Z",
        }),
        onChange: () => undefined,
      }),
      createElement(PlanIntake, {
        draft: intakeDraft("group-size", { groupSize: 4 }),
        onChange: () => undefined,
      }),
      createElement(PlanIntake, {
        draft: intakeDraft("budget", { budget: "value", budgetLimitPence: 2500 }),
        onChange: () => undefined,
      }),
      createElement(WantedCapture),
    ),
  );
  return Array.from(host.querySelectorAll<HTMLInputElement>("input"));
}

describe("plan and Wanted fields expose their input types", () => {
  it("renders an explicit type for every native input", () => {
    const inputs = renderedInputs();

    expect(inputs).toHaveLength(9);
    expect(inputs.map((input) => input.getAttribute("type"))).toEqual([
      "text",
      "text",
      "number",
      "number",
      "datetime-local",
      "number",
      "number",
      "text",
      "text",
    ]);
  });
});
